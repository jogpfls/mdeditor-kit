## What

<!-- What changes, in one or two sentences. -->

## Why

<!-- The problem this solves. If it fixes an issue, link it: Fixes #123 -->

## Notes for the reviewer

<!-- Trade-offs you weighed, anything you are unsure about, anything you
     deliberately left out. -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm run check:deps && npm test && npm run build` passes
- [ ] Added or updated tests
- [ ] If markdown parsing or serialising changed, a round-trip test covers it and `docs/markdown.md` says what changed
- [ ] Ran `npm run changeset` if this affects consumers
