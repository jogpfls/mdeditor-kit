# mdeditor-kit

A lightweight, composable markdown editor toolkit for React.

> **Status: pre-release.** The packaging, build and release pipeline are in place;
> the editor itself is not implemented yet. `0.x` versions may break at any time.

## Install

```bash
npm install mdeditor-kit
```

`react` is a peer dependency (`^18` or `^19`) — install it in your app.

## Usage

```tsx
import 'mdeditor-kit/styles.css';
// Editor exports land here as they are implemented.
```

The stylesheet is optional: skip the import and style the editor yourself, or
import it and override the `--mdeditor-*` custom properties.

## Package layout

| Entry                     | Contents                     |
| ------------------------- | ---------------------------- |
| `mdeditor-kit`            | ESM + CJS bundle, with types |
| `mdeditor-kit/styles.css` | Default theme                |

## Development

```bash
npm install
npm run dev          # tsup in watch mode
npm run test:watch   # vitest in watch mode
```

Before pushing:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

CI runs the same sequence on every push and pull request to `main`.

## Releasing

Releases are driven by [Changesets](https://github.com/changesets/changesets).

1. With your change, run `npm run changeset` and pick the bump type.
2. Commit the generated file in `.changeset/` alongside your code.
3. On merge to `main`, the release workflow opens a "version packages" PR.
4. Merging that PR builds the package and publishes it to npm.

Publishing needs an `NPM_TOKEN` repository secret with publish rights.

## License

[MIT](./LICENSE) © jogpfls
