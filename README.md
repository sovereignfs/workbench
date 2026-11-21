# @sovereignfs/workbench

`wb` is a manifest-driven multi-repo workbench. You list the repos you work
on in a `workbench.manifest.json`. One command then clones them side by side
and keeps them current. When you need a second, concurrent session against
one of them (another AI agent, a parallel experiment), `wb pod create` gives
you a fully isolated clone with its own ports.

The workbench is plain git checkouts in one directory. Every repo still works
on its own: nothing about the workbench is required to build or run any of
them.

- Zero dependencies, no build step. Node ≥ 20 and git.
- Every operation that touches your work refuses to discard it unless you
  pass `--force`: uncommitted changes, unpushed commits and stashes are all
  checked first.

## Install

```sh
npm install -g @sovereignfs/workbench   # provides `wb` (and the long alias `workbench`)
# or, without installing:
npx @sovereignfs/workbench <command>
```

## Quick start

```sh
mkdir my-workbench && cd my-workbench
git init                                 # optional: version the manifest
wb new --name my-workbench               # workbench.manifest.json + .gitignore
wb add git@github.com:me/api.git
wb add git@github.com:me/web.git
wb add git@github.com:me/old-thing.git --skip
wb init                                  # clones api/ and web/
wb status
```

```
my-workbench/
├── workbench.manifest.json
├── .gitignore        # managed block lists every checkout, so none get committed
├── api/  web/        # one checkout per manifest repo, at its "path"
└── pods/             # isolated clones, created on demand
```

`wb` finds the workbench from any directory inside it, pods included. It
looks for the nearest `workbench.manifest.json` at or above the current
directory. To point it somewhere else, use `--root <dir>` or set
`WORKBENCH_ROOT`.

## Commands

Run `wb help` for the full list, or `wb help <command>` for one command.

### Set up

| Command | What it does |
|---|---|
| `wb new [dir] [--name <n>]` | Writes a starter manifest and the managed `.gitignore` block. |
| `wb add <url> [--path] [--id] [--type] [--skip] [--clone]` | Adds a repo to the manifest and its directory to `.gitignore`. |
| `wb gitignore [--check]` | Regenerates the managed `.gitignore` block after you edit the manifest by hand. `--check` exits 1 if the block is stale, which is useful in CI. |

### Checkouts

| Command | What it does |
|---|---|
| `wb init [--https]` | Clones every repo except `skip` entries. Repos that are already cloned get pulled instead. |
| `wb pull --all` / `wb pull <repo>` | Updates each repo's main branch, fast-forward only. |
| `wb pull <repo> --reset [--force]` | Replaces a checkout with a fresh clone. This is also how you clone a `skip` repo. |
| `wb status [<repo>...] [--fetch]` | Shows a table of branch, uncommitted changes, stashes, and ahead/behind against upstream. |
| `wb exec [--only a,b] -- <cmd...>` | Runs a command in every cloned repo and continues past failures. |
| `wb clear [<repo> \| root]` | Stashes local changes, checks out the main branch, and pulls. |

How `pull` behaves on each repo:
- **On the main branch with local changes:** it stashes them (untracked files
  included), pulls, then restores them with `git stash apply`. The stash
  entry is kept, so nothing is lost if the apply conflicts.
- **On another branch:** local main is fast-forwarded in place
  (`git fetch origin main:main`) and your working tree is not touched.

`--reset` clones the fresh copy beside the old checkout before swapping it in,
so a failed clone costs nothing. It also carries over untracked files you
list in `carry`, which is `.env` by default.

`exec` runs without a shell. For pipes or `&&`, use
`wb exec -- sh -c 'git log -1 --oneline && npm test'`.

### Parallel work: pods

| Command | What it does |
|---|---|
| `wb pod create <repo>... [--https]` | Creates an isolated clone of each repo under `pods/`. |
| `wb pod list` | Shows each pod's repo, branch, port block, and any local work. |
| `wb pod remove <pod>... [--force]` | Deletes pods. Refuses if a pod has local work, unless `--force`. |
| `wb kill-port [spec...]` | Kills whatever is listening on the given ports or ranges. macOS/Linux only. |

Two sessions sharing one checkout conflict over more than git. They also
share dev-server ports, `node_modules`, build output and local databases.
`git worktree` still shares a single `.git` directory (refs, the index lock,
hooks). A **pod** shares nothing with the main checkout or with other pods.
It's a complete clone with its own `.git`, dependencies, `.env` and data.

`wb pod create api` does the following:

1. Clones `api` fresh into `pods/api-<n>`, where `n` is the next free number.
2. Copies the `carry` files (`.env` by default) from the main checkout.
3. Rewrites the variables listed in `pod.ports` in those `.env` files to the
   pod's own port block, along with any `localhost:<default>` URLs.
4. Installs dependencies, according to `install`.

Pods are disposable. Delete one with `wb pod remove`. You lose nothing
beyond that pod's own unpushed work, and `wb pod remove` checks for that
before deleting.

`kill-port` kills by port, with no check of who owns the process. Don't run
it if something unrelated is listening on those ports.

## The manifest

```json
{
  "$schema": "https://unpkg.com/@sovereignfs/workbench@0/schema/manifest.schema.json",
  "version": 1,
  "name": "my-workbench",
  "defaults": { "branch": "main", "install": "auto", "carry": [".env"] },
  "pods": { "dir": "pods", "portBase": 5000, "blockSize": 10 },
  "killPort": { "defaults": ["3000-3999", "4000-4999", "5000-5999"] },
  "repos": [
    {
      "id": "api",
      "url": "git@github.com:me/api.git",
      "path": "api",
      "type": "service",
      "pod": {
        "prefix": "api-",
        "ports": [
          { "key": "PORT", "default": 3000 },
          { "key": "ADMIN_PORT", "default": 3001 }
        ]
      }
    },
    { "id": "old-thing", "url": "git@github.com:me/old-thing.git", "path": "old-thing", "skip": true }
  ]
}
```

Everything except `repos` and each repo's `id`, `url` and `path` is
optional. The values shown above are the defaults.

### Top-level fields

| Field | Meaning |
|---|---|
| `version` | Manifest format version. Currently `1`. |
| `defaults.branch` | The branch `pull` and `clear` keep current. |
| `defaults.install` | How a new pod installs dependencies. The values are listed below. |
| `defaults.carry` | Untracked files that follow a repo into pods and across `pull --reset`. |
| `pods.dir`, `pods.portBase`, `pods.blockSize` | Where pods live, and their port blocks. Pod `n`'s block starts at `portBase + (n-1) × blockSize`. |
| `killPort.defaults` | The ports `wb kill-port` targets when you give it none. |

`install` takes one of these values:
- `"auto"` picks the installer from the lockfile, then from the
  `packageManager` field in `package.json`, and falls back to npm.
- `"pnpm"`, `"npm"`, `"yarn"` or `"bun"` runs `<pm> install`, but only when
  there's a `package.json`.
- `false` never installs.
- An argv array such as `["make", "setup"]` always runs that command.

### Repo fields

| Field | Meaning |
|---|---|
| `id` | Short name, and the default pod prefix (`<id>-`). |
| `url` | Clone URL. `--https` rewrites `git@host:org/repo` to `https://host/org/repo.git`. |
| `path` | Where the checkout lives, relative to the root. Must be unique. Commands address repos by `path`; a bare `id` also works. |
| `type` | Free-form label. |
| `skip` | `init` leaves this repo out. You can still clone it on demand with `pull <path> --reset`. |
| `legacy` | Retired repo. It gets no pods, and may reuse another entry's `id`. |
| `branch`, `install`, `carry` | Per-repo overrides of the `defaults`. |
| `pod.prefix` | Pods are named `<prefix><n>`. The prefix must not end in a digit. |
| `pod.ports` | Env vars that get the pod's ports: `ports[i]` = block start + `i`. |

The manifest is validated on every run, before anything touches the disk.
Paths must stay inside the workbench root and must not nest inside each
other. Names that become directory names are restricted. Values that are
passed to git can't start with `-`.

## License

MIT
