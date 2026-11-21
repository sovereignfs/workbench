import { parseArgs } from "node:util";
import { findRepo } from "../manifest.js";
import { isCheckout } from "../git.js";
import { openWorkbench, pullBranch, resetRepo } from "../repos.js";
import { attempt, fail, newResults, printSummary, usageFail } from "../util.js";

export const usage = `wb pull --all
    Update the main branch of every cloned repo, fast-forward only. On that
    branch: stash working-tree changes, pull, stash apply (the stash is kept).
    On another branch: the main branch is fast-forwarded in place.
wb pull <repo>
    Same, for one repo (its manifest path, or id).
wb pull <repo> --reset [--force] [--https]
    Replace <repo> with a fresh clone (also how to clone a "skip" repo). Refuses
    to discard uncommitted, unpushed or stashed work unless --force. "carry"
    files (.env by default) come along.`;

export function run(args, env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      all: { type: "boolean" },
      reset: { type: "boolean" },
      force: { type: "boolean" },
      https: { type: "boolean" },
    },
  });
  const { all, reset, force, https } = values;
  if (Boolean(all) === positionals.length > 0 || positionals.length > 1) {
    usageFail("pass either --all or exactly one repo");
  }
  if (all && reset) usageFail("--reset works on one repo at a time");
  const { manifest } = openWorkbench(env);

  if (!all) {
    const repo = findRepo(manifest, positionals[0]);
    if (!repo) {
      fail(`unknown repo "${positionals[0]}"; expected one of: ${manifest.repos.map((r) => r.path).join(", ")}`);
    }
    attempt(newResults(), repo.path, () => {
      if (reset) return resetRepo(repo, { https, force });
      if (!isCheckout(repo.absPath)) {
        fail(
          `${repo.path}/ is not cloned; run "wb pull ${repo.path} --reset" to clone it` +
            (repo.skip ? ' (it is marked "skip" in the manifest, so init leaves it out)' : "")
        );
      }
      console.log(`[${repo.path}] updating ${repo.branch}...`);
      pullBranch(repo.absPath, repo.branch);
    });
    return;
  }

  const results = newResults();
  for (const repo of manifest.repos) {
    if (!isCheckout(repo.absPath)) {
      results.skipped.push(repo.path);
      continue;
    }
    attempt(results, repo.path, () => {
      console.log(`[${repo.path}] updating ${repo.branch}...`);
      pullBranch(repo.absPath, repo.branch);
    });
  }
  printSummary(results, "not cloned");
}
