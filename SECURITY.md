# Security Policy

## Supported versions

Only the latest published `0.x` release receives fixes while the package is
pre-1.0.

## Reporting a vulnerability

Please do not open a public issue.

Report it through
[GitHub Security Advisories](https://github.com/jogpfls/mdeditor-kit/security/advisories/new).
That channel is private, notifies the maintainers, and keeps the discussion
attached to the repository. You can expect an initial response within a week.

## Scope

The package turns markdown and JSON into HTML (`serializeHtml`) and, once the
editor exists, into `contentEditable` DOM. The most likely class of issue is
**markup injection**: input that gets past the escaping and produces
executable HTML or a script address. Reports in that area are especially
welcome, ideally with the exact input string that triggers it.

By default HTML written in a document is escaped, and link and image
addresses that could run script are dropped. `serializeHtml` with
`allowDangerousHtml: true` writes the document's HTML as it is, by design:
sanitizing that output is the caller's responsibility, and output from that
option is not in scope.
