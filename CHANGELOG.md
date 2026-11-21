# Changelog

## 0.1.0 (unreleased)

First release as a standalone package. This is the workbench CLI from
`sovereignfs/sovereignfs`, made generic.

- Commands: `new`, `add`, `gitignore`, `init`, `pull`, `status`, `exec`,
  `clear`, `pod create|list|remove`, `kill-port`. They are available as `wb`,
  with `workbench` as a long alias.
- The root is found by `--root`, then `WORKBENCH_ROOT`, then the nearest
  `workbench.manifest.json` at or above the current directory.
- Manifest format version 1. The following are now configurable in the
  manifest instead of hardcoded:
  - branch, install command and carried files (`defaults` and per repo)
  - pod dir, port base and block size, pod prefixes and port vars
  - the `kill-port` defaults
- The manifest is validated on load, and a JSON schema is published.
- `--https` rewrites SSH remotes on any host, not only GitHub.
- `clear` takes the repo as a positional argument (`wb clear <repo>`).
