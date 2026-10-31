import { describe, expect, test } from 'vitest';
import { text, type Doc } from '../model';
import { item, lines, p } from '../model/fixtures.test-support';
import { Draft, StepError, applyStep, applySteps, mergeSteps, type Step } from '.';

const doc: Doc = {
  blocks: [
    { id: 'a', type: 'heading', level: 1, content: [text('abcd')] },
    { id: 'b', type: 'bullet', indent: 0, content: [text('ef', [{ type: 'bold' }])] },
    { id: 'c', type: 'divider' },
    { id: 'd', type: 'paragraph', content: [text('gh')] },
  ],
};

/** One example of every step, keyed by type so a new type cannot be forgotten. */
const steps: Record<Step['type'], Step> = {
  replaceText: {
    type: 'replaceText',
    blockId: 'a',
    from: 1,
    to: 3,
    content: [text('XYZ', [{ type: 'italic' }])],
  },
  replaceBlocks: { type: 'replaceBlocks', from: 1, to: 2, blocks: [p('n', 'new')] },
  addMark: {
    type: 'addMark',
    from: { blockId: 'a', offset: 2 },
    to: { blockId: 'd', offset: 1 },
    mark: { type: 'strike' },
  },
  removeMark: {
    type: 'removeMark',
    from: { blockId: 'a', offset: 0 },
    to: { blockId: 'b', offset: 2 },
    mark: { type: 'bold' },
  },
  setBlockKind: { type: 'setBlockKind', fromId: 'a', toId: 'd', kind: { type: 'quote' } },
};

/** The inverse of a step that changes something. */
function inverseOf(inverse: Step | null): Step {
  if (inverse === null) throw new Error('The step changed nothing');
  return inverse;
}

describe.each(Object.entries(steps))('%s', (_, step) => {
  test('its inverse restores the document', () => {
    const { doc: after, inverse } = applyStep(doc, step);
    expect(applyStep(after, inverseOf(inverse)).doc).toEqual(doc);
  });

  test('a block it does not touch keeps its reference', () => {
    const { doc: after } = applyStep(doc, { ...step });
    const untouched = step.type === 'replaceText' ? doc.blocks[3] : doc.blocks[2];
    expect(after.blocks).toContain(untouched);
  });
});

/** One step of every type that changes nothing in `doc`. */
const noops: Record<Step['type'], Step> = {
  replaceText: {
    type: 'replaceText',
    blockId: 'a',
    from: 1,
    to: 3,
    content: [text('b'), text('c')],
  },
  replaceBlocks: { type: 'replaceBlocks', from: 2, to: 2, blocks: [] },
  addMark: {
    type: 'addMark',
    from: { blockId: 'b', offset: 0 },
    to: { blockId: 'c', offset: 0 },
    mark: { type: 'bold' },
  },
  removeMark: {
    type: 'removeMark',
    from: { blockId: 'a', offset: 0 },
    to: { blockId: 'a', offset: 4 },
    mark: { type: 'italic' },
  },
  setBlockKind: { type: 'setBlockKind', fromId: 'c', toId: 'd', kind: { type: 'paragraph' } },
};

test.each(Object.entries(noops))(
  'a %s step that changes nothing gives the same document and no inverse',
  (_, step) => {
    expect(applyStep(doc, step)).toEqual({ doc, inverse: null });
    expect(new Draft(doc).apply(step).hasSteps).toBe(false);
  },
);

test('a step that does not fit the document throws', () => {
  expect(() =>
    applyStep(doc, { type: 'replaceText', blockId: 'c', from: 0, to: 0, content: [] }),
  ).toThrow(StepError);
  expect(() =>
    applyStep(doc, { type: 'replaceText', blockId: 'a', from: 2, to: 9, content: [] }),
  ).toThrow(StepError);
  expect(() => applyStep(doc, { type: 'replaceBlocks', from: 3, to: 9, blocks: [] })).toThrow(
    StepError,
  );
  expect(() =>
    applyStep(doc, { type: 'setBlockKind', fromId: 'd', toId: 'a', kind: { type: 'quote' } }),
  ).toThrow(StepError);
});

describe('setBlockKind', () => {
  test('changes every text block in the range; a list item keeps its indent', () => {
    const before: Doc = {
      blocks: [item('a', 'bullet', 0, 'x'), item('b', 'bullet', 1, 'y'), p('c', 'z')],
    };
    const { doc: after } = applyStep(before, {
      type: 'setBlockKind',
      fromId: 'a',
      toId: 'c',
      kind: { type: 'ordered' },
    });
    expect(lines(after)).toEqual(['ordered0 x', 'ordered1 y', 'ordered0 z']);
  });
});

describe('lists are repaired around a change, and the inverse restores what was repaired', () => {
  test('removing a parent moves its children up', () => {
    const before: Doc = {
      blocks: [
        p('x', 'top'),
        item('a', 'bullet', 0, 'a'),
        item('b', 'bullet', 1, 'b'),
        item('c', 'bullet', 2, 'c'),
      ],
    };
    const { doc: after, inverse } = applyStep(before, {
      type: 'replaceBlocks',
      from: 1,
      to: 2,
      blocks: [],
    });
    expect(lines(after)).toEqual(['paragraph top', 'bullet0 b', 'bullet1 c']);
    expect(applyStep(after, inverseOf(inverse)).doc).toEqual(before);
  });

  test('a start number in the middle of a run is dropped when runs merge', () => {
    const before: Doc = {
      blocks: [
        item('a', 'ordered', 0, 'a'),
        p('x', 'between'),
        { id: 'b', type: 'ordered', indent: 0, start: 5, content: [text('b')] },
      ],
    };
    const { doc: after } = applyStep(before, { type: 'replaceBlocks', from: 1, to: 2, blocks: [] });
    expect(lines(after)).toEqual(['ordered0 a', 'ordered0 b']);
  });
});

describe('Draft', () => {
  test('copies the block array once, however many steps it applies', () => {
    const draft = new Draft(doc);
    draft
      .apply(steps.replaceText)
      .apply(steps.addMark)
      .apply({ type: 'replaceText', blockId: 'd', from: 0, to: 0, content: [text('!')] });
    const { doc: after, inverse } = draft.result();
    expect(after).toEqual(applySteps(doc, draft.result().steps).result().doc);
    expect(applySteps(after, inverse).result().doc).toEqual(doc);
  });

  test('cannot change after its result is taken', () => {
    const draft = new Draft(doc);
    draft.result();
    expect(() => draft.apply(steps.replaceText)).toThrow(StepError);
  });
});

describe('mergeSteps', () => {
  const insert = (from: number, value: string): Step => ({
    type: 'replaceText',
    blockId: 'd',
    from,
    to: from,
    content: [text(value)],
  });
  const remove = (from: number, to: number): Step => ({
    type: 'replaceText',
    blockId: 'd',
    from,
    to,
    content: [],
  });

  test.each([
    ['typing on', [insert(1, 'x'), insert(2, 'y')], insert(1, 'xy')],
    ['deleting backwards', [remove(1, 2), remove(0, 1)], remove(0, 2)],
    ['deleting forwards', [remove(0, 1), remove(0, 1)], remove(0, 2)],
    ['deleting what was typed', [insert(1, 'xy'), remove(2, 3)], insert(1, 'x')],
  ])('merges %s into one step that does the same', (_, [a, b], merged) => {
    if (a === undefined || b === undefined) throw new Error('two steps expected');
    expect(mergeSteps(a, b)).toEqual(merged);
    expect(applySteps(doc, [a, b]).result().doc).toEqual(applySteps(doc, [merged]).result().doc);
  });

  test('does not merge steps that are apart or in different blocks', () => {
    expect(mergeSteps(insert(0, 'x'), insert(2, 'y'))).toBeNull();
    expect(
      mergeSteps(insert(0, 'x'), {
        type: 'replaceText',
        blockId: 'a',
        from: 0,
        to: 0,
        content: [text('y')],
      }),
    ).toBeNull();
    expect(mergeSteps(steps.addMark, insert(0, 'y'))).toBeNull();
  });
});
