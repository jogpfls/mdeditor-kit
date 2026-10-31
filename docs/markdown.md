# Markdown in and out

The editor's document is not markdown: markdown is how it is loaded and
saved. This page says exactly what survives that trip, for `parseMarkdown`
and `serializeMarkdown`. When a document has to come back exactly as it was,
store it with `toJSON()` and read it with `fromJSON()` instead.

## What is read, and what is kept as written

The editor reads CommonMark with GitHub's strikethrough. GitHub tables, task
lists and footnotes are recognized, and kept as written.

| Markdown                                                                                                                                         | In the editor                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Paragraphs, headings 1–4, quotes of paragraphs, `---`                                                                                            | Blocks of those types                                        |
| Bullet and ordered lists, nested up to three levels                                                                                              | List items; an ordered list keeps its start number           |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``                                                                                               | Marks                                                        |
| `[text](url "title")`, `<url>`, `[text][ref]`                                                                                                    | Link marks (a reference link takes its definition's address) |
| Images, inline HTML, footnote references, a link without text                                                                                    | Kept as written, inline (an atom)                            |
| Code blocks, HTML blocks, tables, task lists, footnotes, link definitions, headings 5–6, deeper lists, and quotes or lists holding anything else | Kept as written, as a block of its own                       |

Nothing is dropped or flattened: what the editor cannot represent so that it
writes back the same way is kept as it was written. An indented code block is
kept as a fenced one, and a code fence or HTML block left open at the end of
the document is closed; both render the same.

## What is written

Only markdown, never HTML of the editor's own, so a renderer that does not
allow HTML reads it the same way. HTML that was in the document is written
back as it was.

- An empty paragraph or list item is written as `&nbsp;`; an empty heading,
  or an empty quote on its own, as its bare marker. An empty paragraph inside
  a longer quote is `> &nbsp;`.
- Consecutive quote blocks are one quote, their paragraphs separated by a
  line holding only `>`.
- Where a `*` or `~~` would not be read as a delimiter, the character next to
  it is written as a numeric reference (`**"인용"**&#51008;`), and where two
  delimiters would run together, the other one is used (`*a*__b__`).

## What changes on the way

Writing a document and reading it back gives the same document, except for
these. Each is something markdown cannot express.

| In the editor                                                                       | After writing and reading back                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Bold, italic or strike on whitespace at the edge of what it marks                   | The whitespace, without the mark (`**bold **` is not bold)              |
| A block holding only whitespace (U+00A0 included)                                   | An empty block                                                          |
| NUL anywhere                                                                        | U+FFFD                                                                  |
| Code inside a link that starts a line, holding `]` right before `:`                 | The text, without the code mark (it would read as a link definition)    |
| A paragraph or quote whose line starts like an HTML block (`<div>`, a lone `<kbd>`) | A block kept as written                                                 |
| A list item whose line starts like an HTML block                                    | The item holding that line, kept as written                             |
| Such an item with items nested under it, when its HTML runs on past the line        | The whole list, kept as written (the nested items are part of the HTML) |
| Two blocks kept as written that markdown reads as one                               | One block kept as written                                               |

Reading markdown from elsewhere and writing it again keeps its meaning, apart
from these:

| In the markdown                                                         | Written back as                            |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| A hard line break inside a paragraph                                    | Two paragraphs (one line is one block)     |
| Soft line breaks                                                        | One line, joined with spaces               |
| A loose list                                                            | A tight list                               |
| Two neighbouring lists of the same kind, or quotes                      | One list, or one quote                     |
| Emphasis around a link, or around other emphasis covering the same text | The same marks, nested the other way round |
| Two neighbouring links to the same address                              | One link                                   |
| Formatting written another way (`_a_`, `Title\n===`)                    | The editor's way (`*a*`, `# Title`)        |

These are checked by tests: every CommonMark specification example, real
READMEs and random markdown are written back and rendered both with and
without HTML (`test/markdown-contract`).
