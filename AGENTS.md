# AGENTS.md

Guidance for any AI agent (or human) working in this repo. `CLAUDE.md` points
here; this file is the canonical source.

## What this repo is

`@sovereignfs/workbench`: the `wb` CLI, published to npm. It reads a
`workbench.manifest.json` and checks out, updates and pods the repos it lists.
It is generic: nothing in it may assume a particular ecosystem, org, host,
branch name, package manager or port layout. Those belong in a manifest.
See [README.md](README.md) for usage.

## Layout

```
bin/workbench.js            # entry point (bin: wb, workbench)
src/cli.js                  # global flags, dispatch, top-level usage
src/commands/<name>.js      # one command per file: exports `usage` and `run(args, env)`
src/manifest.js             # load + validate + normalise the manifest; findRepo()
src/root.js                 # root discovery (--root, WORKBENCH_ROOT, walk up)
src/repos.js                # clone/pull/reset of main checkouts, install resolution
src/git.js  src/env.js  src/gitignore.js  src/util.js
schema/manifest.schema.json # published JSON schema for the manifest
test/                       # node --test; helpers.js builds throwaway fixtures
```

## Conventions

- Keep both bins. `wb` is the documented command. `workbench` is the bin that
  `npx @sovereignfs/workbench` runs by default, because npm picks the bin
  whose name matches the unscoped package name. Dropping it breaks `npx`
  usage, including the shim in sovereignfs/sovereignfs.

- Node ≥ 20, ESM, built-ins only. Don't add dependencies or a build step.
- New command: add `src/commands/<name>.js` with `usage` + `run(args, env)`,
  then register it in `COMMANDS` and `GROUPS` in `src/cli.js`. Parse flags
  with `node:util` `parseArgs`. Get the root and manifest with
  `openWorkbench(env)`.
- Errors meant for the user: throw with `fail()`, or with `usageFail()` to
  also print the command's usage. Never call `process.exit`.
- Commands that loop over repos or pods wrap each item in `attempt()`, carry
  on past failures, and finish with `printSummary()`.
- Shell out with `execFileSync` and argv arrays, via `git()` / `gitOut()`.
  Never use shell strings. Put `--` before user-controlled positional args
  to git (see `cloneRepo`).
- Address repos by `path`, which is unique. Use `findRepo()`; don't match on
  `id` directly.
- Anything new in the manifest goes in three places in the same change:
  `normalizeManifest()` (with validation), `schema/manifest.schema.json`,
  and the README.

## Safety rules

The CLI operates on other repos' working trees, so it must protect user work:

- The manifest is untrusted input. Validate every path it supplies before
  it reaches `rmSync`, `renameSync` or `git`.
  - Keep it relative.
  - Keep it free of `..`.
  - Keep it inside the root, and never the root itself.
- `pull` stashes before touching a dirty branch and restores with
  `stash apply` (not `pop`). It is fast-forward only.
- `pull --reset` clones first and swaps second. It refuses to discard work
  (`localWorkProblems()`) unless `--force`. `pod remove` uses the same guard.
- `clear` stashes before resetting.
- `kill-port` kills by port with no ownership check. Don't run it on
  anyone's machine unprompted.
- Don't add anything that deletes or overwrites a checkout without a guard
  like the ones above.

## Testing

```sh
npm run check   # node --check on every file
npm test        # node --test test/*.test.js
```

Integration tests run the real CLI against a scratch workbench built by
`makeFixture()` in `test/helpers.js`:
- local bare repos, created with `git init --bare -b main`
- a manifest pointing at them
- git running with an empty global config

Never point tests at real remotes. Cover the failure paths too:
- dirty tree, feature branch
- unpushed commits, stashes
- legacy and unknown names
- invalid manifests

Before a release, run `npm pack`, install the tarball in a scratch directory,
and run `wb` from a subdirectory of a fixture workbench. That exercises root
discovery from `node_modules`.

## Keeping docs in sync

Behaviour is described in three places:
- each command's `usage`
- the README
- `CHANGELOG.md`, for released changes

Update all of them in the same commit. When a feature is removed, remove
its mentions everywhere instead of leaving a history note (the changelog
excepted).
