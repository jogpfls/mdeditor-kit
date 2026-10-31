# mdeditor-kit

[![CI](https://github.com/jogpfls/mdeditor-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/jogpfls/mdeditor-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A live markdown editor for React, where markdown syntax turns into formatting
as you type it: `# ` makes a heading and disappears.

> **Status: in development, not published.** Only the framework-free core is
> implemented. There is no editor component yet, and the package name is not
> decided (`mdeditor-kit` is the repository's name). Usage instructions come
> with the editor.

## What exists today

The core (`src/core`) is the editor's document model and everything that does
not need a screen:

- **The document model.** One line is one block: paragraphs, headings 1–4,
  quotes, bullet and ordered lists nested up to three levels, dividers. Text
  carries bold, italic, strikethrough, inline code and links. What the model
  cannot represent — code blocks, tables, images, HTML — is kept exactly as it
  was written, never dropped or flattened.
- **Editing.** Commands for typing, deleting, splitting and joining blocks,
  formatting and pasting; undo and redo with grouped typing; and the input
  rules that turn typed markdown (`**bold**`, `- `, `1. `, `---` …) into
  formatting.
- **Markdown in and out.** Reading markdown and writing it back keeps its
  meaning, checked against the whole CommonMark specification and real
  documents. [docs/markdown.md](docs/markdown.md) lists exactly what is
  preserved and what changes.
- **JSON and HTML.** A lossless, versioned JSON storage format, and HTML
  output with the document's own HTML escaped by default.

The package will have two entries: the React editor, and `./core`, for code
that converts documents without an editor on screen (`parseMarkdown`,
`serializeMarkdown`, `serializeHtml`, `toJSON`, `fromJSON`). Their cost is in
[docs/performance.md](docs/performance.md).

## Documentation

| Document                                   | For                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| [docs/spec/spec.md](docs/spec/spec.md)     | The specification and design decisions (Korean); the source for everything else |
| [docs/markdown.md](docs/markdown.md)       | What survives the trip through markdown                                         |
| [docs/performance.md](docs/performance.md) | Measured costs, and bundle size                                                 |
| [CONTRIBUTING.md](CONTRIBUTING.md)         | Setup, architecture, and the rules stricter than usual                          |
| [MAINTAINING.md](MAINTAINING.md)           | Publishing a release                                                            |

## License

[MIT](LICENSE)
