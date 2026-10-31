# Contributing

Thanks for taking the time. This document covers the setup, the architecture,
the rules that are stricter than usual, and why they are there.

The product specification, the architecture and the record of design
decisions live in [docs/spec/spec.md](docs/spec/spec.md) (in Korean). It is
the single source: this document summarises it for contributors, and when the
two disagree, the spec wins and this document is fixed.

**Status:** the framework-free core (`src/core`), the render layer
(`src/view/render`), a read-only view (`src/view/view.ts`), and the `MdViewer`
React component (`src/react`) are implemented. The editing layers (selection,
input, composition, clipboard, guard, full editor, CSS) are not written yet;
the decisions already taken for them are in section 9 of the spec.

## Setup

**Node 22 is what CI uses for its checks.** There is an `.nvmrc`, so
`nvm use` picks the right one. The `engines` field (`>=22.12.0`) is the
oldest Node the package supports: the oldest Node line still maintained, at
the first release the build tools need. CI reads that version from
`package.json` and runs the tests on it and on the current LTS (`lts/*`), so
the field and the tests cannot drift apart. When a Node line reaches end of
life, raise `engines` in a major release.

```bash
nvm use          # optional, reads .nvmrc
npm install      # installs the git hooks too
npm run dev      # tsup in watch mode
npm run test:watch
```

Before opening a pull request:

```bash
npm run lint && npm run typecheck && npm run check:deps && npm test && npm run build
```

Only the commit is gated locally: a pre-commit hook runs ESLint and Prettier on
staged files. Types and tests are **not** checked on push, so that a
work-in-progress branch can always be pushed. CI is the real gate, and `main`
is protected: every CI job has to pass before a pull request merges.

`npm run typecheck` covers three projects:

| Project               | Covers                                  | Environment                                    |
| --------------------- | --------------------------------------- | ---------------------------------------------- |
| `tsconfig.json`       | `src`                                   | Browser (DOM)                                  |
| `tsconfig.core.json`  | `src/core`                              | The language only: no DOM, no Node, no globals |
| `tsconfig.tools.json` | `scripts/`, `e2e/` and the config files | Node                                           |

If you add a file outside `src`, add it to the tools project or it will not be
type-checked at all.

Coverage has thresholds just under what the suite covers today. They are a
ratchet: raise them when you raise coverage, never lower them to go green.

CI runs the same commands plus `check:exports` (published package metadata),
`check:package` (installs the packed tarball, then imports and bundles both
entries), `check:size` (bundle size budgets) and `check:unused` (dead code).

### Kinds of test

- `src/core/**/*.test.ts` runs in Node with no DOM at all, as core itself does.
  The markdown round trip and the command invariants are checked with
  property-based tests (fast-check).
- Tests follow the same import rules as the code they test: a module's tests
  import only what the module itself may import. Hand-written blocks and
  random documents live in `core/model/*.test-support.ts`, so every module can
  use them. A test that exercises several modules together, like the command
  invariants, lives directly in `src/core/`. Production code never imports a
  `*.test-support.ts` file.
- `test/markdown-contract` holds the editor's markdown up against real
  renderers (spec 5-6), and `test/public-api` pins the names each package
  entry exports.
- A behaviour known not to hold yet is a `test.fails`, so the suite notices
  when it starts to hold.

## Architecture

### Modules

```
src/
  index.ts           the `.` entry (the React editor will live here)
  core/              depends on nothing: no DOM, no React, no globals
    lang/            language helpers unrelated to the domain (assertNever)
    model/           the shape of a document and its invariants
    transform/       atomic document changes (steps) and their inverses
    state/           editor state, selection, transactions
    history/         undo and redo
    formats/         the table of supported formats
    queries/         values computed from state (formatStates, arrowSelection)
    commands/        user intent turned into transactions
    input-rules/     typed patterns turned into transactions
    markdown/        markdown: Doc ⇄ string, and rendering raw source
    html/            Doc → HTML string
    json/            Doc ⇄ the JSON storage format
    url-policy/      which link addresses may be written out
    index.ts         the `./core` entry
    internal.ts      everything the editor's own layers use; not an entry
```

Modules are split by two questions, in this order:

1. **What does it depend on?** That is decided by its imports alone. `core`
   imports nothing outside itself, and `tsconfig.core.json` turns any DOM or
   Node global used in `src/core` into a compile error.
2. **What does it own?** Each module owns one piece of data and its
   invariants, or one boundary. You should be able to say what it does in one
   sentence without "and". If you cannot, split it.

Do not split by kind of code: no `types/`, `utils/`, `constants/`, `helpers/`
or `hooks/` folders. A type lives with the functions that keep its invariants.
Inside a module, split into files freely; outside it, import only the module's
`index.ts`, and import types with `import type`.

`npm run check:deps` (dependency-cruiser) enforces all of this, tests
included. `CORE_MODULES` in `.dependency-cruiser.mjs` lists what each core
module may import; a new core module needs a row there. It also checks that:

- core imports nothing outside `src/core`, no Node built-ins, and no npm
  package except the markdown parser and renderer, which only `core/markdown`
  may use;
- the layers still to come keep their direction: `view` reaches core only
  through `core/index.ts` or `core/internal.ts` and never imports React, and
  `react` does not import `view`;
- there are no import cycles.

### Formats and other rules are data

`FORMATS` in `core/formats` is the only list of formats. `MARKDOWN_SYNTAX` in
`core/markdown` is the only list of markdown syntax: heading and quote
markers, list markers, the divider, and each mark's delimiters. The
serializer, its escaping rules and the input rules are all derived from it.
The number of heading levels comes from the `HeadingLevel` type in
`core/model`; `FORMATS` is type-checked against it, so adding a level fails to
compile until its format exists.

Every classification is an exhaustive `switch` ending in `assertNever` — on
`Mark`, `Block['type']`, `FormatSpec['kind']`, steps, transaction origins.
Never let `else` mean "everything else". A comparison that asks about a single
case (`block.type === 'paragraph'`) is fine; a branch that gives the remaining
cases a meaning (`type === 'ordered' ? number : bullet`) is a classification
and needs the switch. Adding a format touches `model`, `formats`,
`input-rules`, `markdown` and `html` (and the view and CSS once they exist);
that span is inherent, and the switches make the compiler point at every place
you missed.

### The model, in short

Spec section 5-1 is the full definition.

- A block is a paragraph, heading (1–4), quote, bullet or ordered list item,
  divider, or **raw block**: source the model cannot represent (a code block,
  an HTML block, a link definition), kept verbatim and edited only as a whole.
- A text block's content is **text runs** and **atoms**. An atom is inline
  source the model cannot represent (an image, inline HTML), kept verbatim.
  It takes one position, cannot be edited from inside, and input rules never
  look into it.
- Marks are objects: `{ type: 'bold' }`, `{ type: 'link', href, title? }`.
  Links have no format and no input rule: they are kept, written and output,
  not created. Each mark type declares whether it is `inclusive` (code and
  links are not): typing right after a code span or a link writes plain text.
- One line is one block: text never holds a line break. Block ids are unique
  and come from an injected function, so core stays deterministic. A list is
  a tree stored flat. Commands keep these invariants themselves;
  `normalizeDoc` restores them where outside input enters (parsing, JSON).

### Changes and history

Spec section 5-3 is the full definition.

- A command builds its transaction in a `Draft`, which copies the block
  array once and applies each step as it comes, keeping the step that undoes
  it. Applying a transaction to any document but the one it was built
  against throws.
- **A command that changes nothing returns `null`**, never an empty
  transaction: every command ends in `finish`, which compares the result
  with the state (`changesNothing`). A step that changes nothing is not
  recorded.
- `npm run bench` measures how editing and conversion cost grow with
  document size. It is not a CI gate; run it when a change may affect
  performance, and update [docs/performance.md](docs/performance.md) when the
  numbers move.

### Markdown, JSON and HTML

- For every document, `parseMarkdown(serializeMarkdown(doc))` equals
  `canonical(doc)` (ignoring ids). Reading markdown from elsewhere keeps what
  the model cannot represent as written, never flattened (decision D2), and
  writing uses no HTML of its own (D3). [docs/markdown.md](docs/markdown.md)
  is the public list of what changes on the way.
- `toJSON`/`fromJSON` are the lossless format. Whenever `Doc` changes shape,
  raise `SCHEMA_VERSION` and add a migration (spec 5-9).
- `serializeHtml` escapes all text and renders raw source with micromark,
  HTML escaped and script addresses dropped. Its `allowDangerousHtml: true`
  writes the document's HTML as it is; the docs must keep saying that whoever
  shows the result has to sanitize it (spec 5-7).

## Rules lint does not catch

Spec section 6 is the full list.

- **No workarounds.** If you need `setTimeout` or `requestAnimationFrame` to
  get the caret right, `execCommand`, a direct DOM fix that skips the model, or
  a type assertion, the design is wrong somewhere. Stop and raise it.
- **No layout reads during rendering or in event handlers**
  (`offsetHeight`, `getBoundingClientRect`, `getComputedStyle`, `innerText`).
- **No `innerHTML`, `outerHTML` or `insertAdjacentHTML` with user content.**
- **No module-level mutable state.** Several editors on one page must be
  independent.
- **No optimisation without a measurement.** No memoisation, caches,
  virtualisation or workers for a problem nobody measured.
- **React:** `useMemo`, `useCallback` and `memo` only for correctness (an
  outside API that needs a stable reference) or for a performance problem a
  measurement confirmed, with a comment giving the reason or the numbers. `useEffect`
  only to sync with something outside React; derived values are never state.

## Lint rules worth knowing

Most of the config is ordinary. These surprise people:

| Rule                                                  | Why                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `strict-boolean-expressions`                          | `if (count)` is false for `0`. Write the condition you mean: `count > 0`.                                                        |
| `no-magic-numbers`                                    | Numbers in an editor are usually offsets. A name says which. Literal types (`1 \| 2`) and tests are exempt.                      |
| `consistent-type-assertions`, `no-non-null-assertion` | Narrow with discriminated unions and type guards. `as const` is fine.                                                            |
| `switch-exhaustiveness-check`                         | A `switch` over a union names every case, so a new case is a compile error wherever it is not handled.                           |
| `eslint-comments/no-use` and `ban-ts-comment`         | Silencing the checker hides the cause. If a rule is genuinely wrong, open an issue and we will change the rule, not the comment. |
| `no-restricted-syntax` on `setTimeout(fn, 0)`         | It defers a timing problem rather than removing it.                                                                              |

## Commits and releases

Releases run on [Changesets](https://github.com/changesets/changesets). If your
change affects consumers:

```bash
npm run changeset
```

Pick the bump type, describe the change in one line, and commit the generated
file in `.changeset/`. Internal-only changes do not need one.

## Reporting bugs

The most useful report is the smallest input that shows the problem: for
markdown, the exact string, what came back, and what you expected.
