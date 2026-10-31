# Maintaining

Everything needed to publish a release. Contributors want
[CONTRIBUTING.md](CONTRIBUTING.md) instead.

## One-time setup

Publishing fails without all four of these.

| What                                | Where                                               | Why                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN` secret                  | Settings → Secrets and variables → Actions          | The publish step authenticates with it. Use a **granular access token** scoped to this package with read and write, or a classic **automation** token — a classic _publish_ token is blocked by 2FA in CI. |
| Allow Actions to open PRs           | Settings → Actions → General → Workflow permissions | Changesets opens the "version packages" PR through `GITHUB_TOKEN`. With this off it fails, and the failure is easy to miss.                                                                                |
| Public repository                   | Settings → General                                  | `publishConfig.provenance` is on. Provenance requires a public repo and `id-token: write`, which `release.yml` already grants. On a private repo, drop `provenance` or the publish fails.                  |
| npm 2FA set to "authorization only" | npmjs.com → Account                                 | With 2FA required for writes, a CI publish cannot complete. Automation and granular tokens bypass it; account-level settings can still block them.                                                         |

`main` is protected: every required CI check must pass, force pushes and
deletions are refused, and conversations must be resolved. Admin enforcement is
**off**, so a maintainer can still push directly when they need to — turn it on
once the project has more than one of them.

Granular access tokens expire. Put the expiry in a calendar — an expired token
fails the release with a 401 that looks like a permissions bug.

## Releasing

The flow is [Changesets](https://github.com/changesets/changesets). Nothing is
published by hand.

1. **Changes land on `main` with a changeset.** Contributors add one with
   `npm run changeset`; the PR template asks for it.
2. **`release.yml` runs on every push to `main`.** Its first job _calls_
   `ci.yml` rather than repeating it, so the publish gate and the pull-request
   gate are the same checks by construction and cannot drift. Changesets runs
   only after that passes — a red build never publishes.
3. **With changesets pending, it opens or updates a `chore: version packages`
   PR.** That PR applies the version bump and writes `CHANGELOG.md`. Nothing is
   published yet.
4. **Merging that PR publishes to npm.** The same workflow runs again, sees no
   pending changesets, and runs `changeset publish`.

So a release is one action: **merge the version PR**.

### The first release

The package is at `0.0.0` and has never been published, and its name is not
decided yet (the `name` field in `package.json` is a placeholder). Before the
first release:

- Go through the pre-release checklist in section 8-4 of
  [the spec](docs/spec/spec.md).
- Decide the name and confirm it is free: `npm view <name>`.
- Add a changeset with a **minor** bump so the first version is `0.1.0` rather
  than `0.0.1`.

### Checking a release

```bash
npm view <name>
npm view <name> dist-tags
```

The npm page should show a "Provenance" panel linking back to the workflow run.
If it does not, the publish did not run through Actions.

## Versioning while at 0.x

`0.x` has no stable API guarantee, but the changelog should still be readable:

- **minor** for anything a consumer would notice — new syntax, changed markdown
  output, removed or renamed exports.
- **patch** for fixes that keep the same markdown and the same exports.

The names each entry exports are public API, pinned by `test/public-api`.
Removing or renaming one is a minor bump at least, and after `1.0.0` a major.

## When something breaks

**Never `npm unpublish`.** It breaks anyone who already installed it. Publish a
fix instead, and deprecate the bad version:

```bash
npm deprecate <name>@0.1.3 "Broken paste handling, use 0.1.4"
```

**The version PR did not appear.** Almost always the "Allow Actions to open PRs"
setting. Check the `release` job log for a 403 from the GitHub API.

**Publish failed with 401 or 403.** The `NPM_TOKEN` expired, lost its scope, or
is a classic _publish_ token rather than an automation one.
