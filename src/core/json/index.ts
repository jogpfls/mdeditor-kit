/**
 * The lossless storage format: `{ schemaVersion, doc }`. Loading accepts
 * every version this release knows, migrates it to the current one, checks
 * every field, and normalizes the result.
 *
 * Block ids are not stored. They identify blocks inside one editor session
 * (for rendering and positions), not across sessions, so loading gives every
 * block a new one.
 */
import { assertNever } from '../lang';
import {
  isHeadingLevel,
  normalizeDoc,
  type Block,
  idCounter,
  type CreateId,
  type Doc,
  type Inline,
  type Mark,
} from '../model';

/** The version `toJSON` writes. Raise it, and add a migration, whenever `Doc` changes shape. */
export const SCHEMA_VERSION = 1;

/** A block as stored: everything but its id. */
export type StoredBlock = Block extends infer B ? (B extends Block ? Omit<B, 'id'> : never) : never;

export type MdJSON = {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly doc: { readonly blocks: readonly StoredBlock[] };
};

/**
 * Turns the `doc` of one version into the `doc` of the next. `MIGRATIONS[i]`
 * takes version `i + 1` to version `i + 2`, so there is always one fewer
 * migration than versions.
 */
type Migration = (doc: unknown) => unknown;

const MIGRATIONS: readonly Migration[] = [];

/** JSON that is not a document this release can load. `path` says where. */
export class SchemaError extends Error {
  override readonly name = 'SchemaError';
  constructor(
    readonly path: string,
    problem: string,
  ) {
    super(`${path}: ${problem}`);
  }
}

export function toJSON(doc: Doc): MdJSON {
  return { schemaVersion: SCHEMA_VERSION, doc: { blocks: doc.blocks.map(storedBlock) } };
}

function storedBlock(block: Block): StoredBlock {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
      return { type: block.type, content: block.content };
    case 'heading':
      return { type: block.type, level: block.level, content: block.content };
    case 'bullet':
      return { type: block.type, indent: block.indent, content: block.content };
    case 'ordered':
      return block.start === undefined
        ? { type: block.type, indent: block.indent, content: block.content }
        : { type: block.type, indent: block.indent, start: block.start, content: block.content };
    case 'divider':
      return { type: block.type };
    case 'raw':
      return { type: block.type, source: block.source };
    default:
      return assertNever(block);
  }
}

/**
 * Reads stored JSON back into a document, giving every block a new id from
 * `createId`, by default a counter of this call's own. Throws `SchemaError` for an unknown or newer version and for any
 * field of the wrong shape, rather than guessing. An `id` field, as older
 * copies of version 1 wrote, is ignored.
 */
export function fromJSON(value: unknown, createId: CreateId = idCounter()): Doc {
  const root = record(value, 'json');
  const version = root['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SchemaError('json.schemaVersion', 'must be a positive integer');
  }
  if (version > SCHEMA_VERSION) {
    throw new SchemaError(
      'json.schemaVersion',
      `version ${version} was written by a newer release; this one reads up to ${SCHEMA_VERSION}`,
    );
  }
  const migrated = MIGRATIONS.slice(version - 1).reduce(
    (doc, migrate) => migrate(doc),
    root['doc'],
  );
  return normalizeDoc(readDoc(migrated, 'json.doc', createId), createId);
}

// ---------------------------------------------------------------------------
// Reading. One reader per type, in tables keyed by the model's own unions, so
// a new block type, inline or mark fails to compile until it can be loaded.

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Fields {
  if (!isFields(value)) throw new SchemaError(path, 'must be an object');
  return value;
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(path, 'must be an array');
  return value;
}

function string(fields: Fields, key: string, path: string): string {
  const value = fields[key];
  if (typeof value !== 'string') throw new SchemaError(`${path}.${key}`, 'must be a string');
  return value;
}

function optionalString(fields: Fields, key: string, path: string): string | undefined {
  return fields[key] === undefined ? undefined : string(fields, key, path);
}

function integer(fields: Fields, key: string, path: string): number {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new SchemaError(`${path}.${key}`, 'must be a non-negative integer');
  }
  return value;
}

function readDoc(value: unknown, path: string, createId: CreateId): Doc {
  const fields = record(value, path);
  return {
    blocks: list(fields['blocks'], `${path}.blocks`).map((block, index) =>
      readBlock(block, `${path}.blocks[${index}]`, createId()),
    ),
  };
}

type Reader<T> = (fields: Fields, path: string) => T;
type BlockReader<T> = (fields: Fields, path: string, id: string) => T;

const BLOCK_READERS: { readonly [T in Block['type']]: BlockReader<Extract<Block, { type: T }>> } = {
  paragraph: (fields, path, id) => ({
    id,
    type: 'paragraph',
    content: readContent(fields, path),
  }),
  heading: (fields, path, id) => {
    const level = integer(fields, 'level', path);
    if (!isHeadingLevel(level)) throw new SchemaError(`${path}.level`, 'is not a heading level');
    return {
      id,
      type: 'heading',
      level,
      content: readContent(fields, path),
    };
  },
  quote: (fields, path, id) => ({
    id,
    type: 'quote',
    content: readContent(fields, path),
  }),
  bullet: (fields, path, id) => ({
    id,
    type: 'bullet',
    indent: integer(fields, 'indent', path),
    content: readContent(fields, path),
  }),
  ordered: (fields, path, id) => {
    const base = {
      id,
      type: 'ordered',
      indent: integer(fields, 'indent', path),
      content: readContent(fields, path),
    } as const;
    return fields['start'] === undefined
      ? base
      : { ...base, start: integer(fields, 'start', path) };
  },
  divider: (_fields, _path, id) => ({ id, type: 'divider' }),
  raw: (fields, path, id) => ({
    id,
    type: 'raw',
    source: string(fields, 'source', path),
  }),
};

function isBlockType(type: string): type is Block['type'] {
  return Object.prototype.hasOwnProperty.call(BLOCK_READERS, type);
}

function readBlock(value: unknown, path: string, id: string): Block {
  const fields = record(value, path);
  const type = string(fields, 'type', path);
  if (!isBlockType(type)) throw new SchemaError(`${path}.type`, `unknown block type "${type}"`);
  return BLOCK_READERS[type](fields, path, id);
}

function readContent(fields: Fields, path: string): readonly Inline[] {
  return list(fields['content'], `${path}.content`).map((inline, index) =>
    readInline(inline, `${path}.content[${index}]`),
  );
}

const INLINE_READERS: { readonly [T in Inline['type']]: Reader<Extract<Inline, { type: T }>> } = {
  text: (fields, path) => ({
    type: 'text',
    text: string(fields, 'text', path),
    marks: readMarks(fields, path),
  }),
  raw: (fields, path) => ({
    type: 'raw',
    source: string(fields, 'source', path),
    marks: readMarks(fields, path),
  }),
};

function isInlineType(type: string): type is Inline['type'] {
  return Object.prototype.hasOwnProperty.call(INLINE_READERS, type);
}

function readInline(value: unknown, path: string): Inline {
  const fields = record(value, path);
  const type = string(fields, 'type', path);
  if (!isInlineType(type)) throw new SchemaError(`${path}.type`, `unknown inline type "${type}"`);
  return INLINE_READERS[type](fields, path);
}

const MARK_READERS: { readonly [T in Mark['type']]: Reader<Extract<Mark, { type: T }>> } = {
  link: (fields, path) => {
    const href = string(fields, 'href', path);
    const title = optionalString(fields, 'title', path);
    return title === undefined ? { type: 'link', href } : { type: 'link', href, title };
  },
  strike: () => ({ type: 'strike' }),
  bold: () => ({ type: 'bold' }),
  italic: () => ({ type: 'italic' }),
  code: () => ({ type: 'code' }),
};

function isMarkReaderType(type: string): type is Mark['type'] {
  return Object.prototype.hasOwnProperty.call(MARK_READERS, type);
}

function readMarks(fields: Fields, path: string): readonly Mark[] {
  return list(fields['marks'], `${path}.marks`).map((value, index) => {
    const markPath = `${path}.marks[${index}]`;
    const mark = record(value, markPath);
    const type = string(mark, 'type', markPath);
    if (!isMarkReaderType(type))
      throw new SchemaError(`${markPath}.type`, `unknown mark type "${type}"`);
    return MARK_READERS[type](mark, markPath);
  });
}
