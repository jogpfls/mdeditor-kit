# Performance

What the editor's core costs as documents grow, and what its entries add to a
bundle, measured. Only the core exists so far: the editing figures are the
cost of a change to the document model, which the editor's view will add its
rendering to. Every timing here comes from `npm run bench`
(`scripts/bench-core.ts`), which runs each operation on documents of 10,000
and 20,000 blocks: run it on your machine for your own numbers. The figures
below were taken with Node 24 on an Apple Silicon laptop, median of five runs.

## Editing the model

| Operation                           | 10,000 blocks | 20,000 blocks |
| ----------------------------------- | ------------: | ------------: |
| One keystroke, with input rules     |       0.26 ms |       0.44 ms |
| Enter                               |       0.13 ms |       0.38 ms |
| Select all, delete                  |       0.23 ms |       0.45 ms |
| Paste 5,000 blocks                  |        4.0 ms |        3.5 ms |
| Select all, italic                  |         13 ms |         29 ms |
| Whether bold is active, over it all |        0.3 ms |        0.5 ms |

Every edit costs time in proportion to the document's length: applying a
change copies the array of blocks once (blocks themselves are shared, not
copied) and finds blocks by scanning it. At 20,000 blocks a keystroke still
takes under half a millisecond, far inside a 16 ms frame, so core does not
keep an index that would have to be rebuilt after every structural change.
Formatting a whole document visits every block and stays a one-off cost of a
click. The state of every format is worked out in one pass over the
selection, which stops as soon as nothing further can turn a format on.

## Converting

| Operation          | 10,000 blocks | 20,000 blocks |
| ------------------ | ------------: | ------------: |
| Serialize markdown |         43 ms |         88 ms |
| Serialize HTML     |         13 ms |         24 ms |

Serializing is linear, about 4 µs per block for markdown.

### Parsing

Parsing (`parseMarkdown`) is what loading markdown costs. Almost all of its time is spent in the CommonMark parser
the editor builds on (`mdast-util-from-markdown`); mapping its result onto
the document adds little. How long it takes depends on the shape of the
markdown, not only on its length:

| Markdown                                            | 2,500 blocks | 5,000 blocks | 10,000 blocks | 20,000 blocks |
| --------------------------------------------------- | -----------: | -----------: | ------------: | ------------: |
| Paragraphs only                                     |        76 ms |       184 ms |        240 ms |        511 ms |
| Headings only                                       |        63 ms |       125 ms |        284 ms |        537 ms |
| One long list                                       |        98 ms |       218 ms |        287 ms |        659 ms |
| One long quote                                      |       125 ms |       192 ms |        297 ms |        576 ms |
| Lists of three items, each followed by a paragraph  |       115 ms |       364 ms |         1.3 s |         4.5 s |
| Quotes of three lines, each followed by a paragraph |       103 ms |       356 ms |         1.1 s |         5.0 s |
| One-item lists between paragraphs                   |       151 ms |       549 ms |         2.3 s |         9.9 s |

Paragraphs, headings, and one list or one quote however long are linear.
What grows faster is **a list or a quote that ends with more of the document
after it**: each one costs time in proportion to the length of the document,
so a document with many separate lists or quotes costs close to the square of
its length. Doubling such a document makes parsing about four times slower.
Lists that follow each other directly, with nothing between them, do not
count: they stay linear.

Typical notes and posts, with a few dozen lists, parse in well under a
second. For large documents with many lists, store them as JSON (`toJSON()`
and `fromJSON()`), which skips parsing altogether and also keeps the document
exactly.

## Bundle size

What each entry adds to an app, measured by `npm run check:size` the way an
app's bundler sees it: ESM, minified, unused exports dropped, gzipped. CI
fails when a case goes over its budget.

| What the app imports                                 | Minified | Gzipped |  Budget |
| ---------------------------------------------------- | -------: | ------: | ------: |
| `.` (everything)                                     | 114.3 kB | 34.1 kB | 38.0 kB |
| `./core` (everything)                                | 111.2 kB | 32.5 kB | 36.0 kB |
| `./core`: `parseMarkdown`, `serializeMarkdown`, JSON |  98.5 kB | 28.6 kB | 32.0 kB |
| `./core`: `fromJSON`, `serializeHtml`                |  94.2 kB | 27.3 kB | 30.0 kB |
| `./core`: `toJSON`, `fromJSON`                       |  10.7 kB |  3.7 kB |  4.5 kB |

Most of it is the CommonMark parser (micromark and `mdast-util-from-markdown`,
about 60 kB minified). `serializeHtml` needs it too: it renders the source the
document keeps as written (tables, images, HTML) by reading it as markdown.
Code that only stores and loads JSON pays for neither.

## Serializing in your app

Serializing is cheap and linear: at a few thousand blocks, writing markdown on
every keystroke still fits in a frame; past that, debounce it.
