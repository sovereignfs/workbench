import { parseArgs } from "node:util";
import { findRepo } from "../manifest.js";
import { git, isCheckout } from "../git.js";
import { openWorkbench } from "../repos.js";
import { attempt, fail, newResults, printSummary, usageFail } from "../util.js";

export const usage = `wb clear [<repo> | root]
    Reset checkouts to a clean main branch: stash local changes (untracked
    included) for safety, check out the branch, pull --ff-only. With no
    argument: the workbench root (if it is a git checkout) and every cloned repo.`;

// Stashes any local changes, then resets to a clean branch. `git stash push`
// exits 0 with "No local changes to save" when there's nothing to stash.
function clearRepo(dir, branch) {
  git(["-C", dir, "stash", "push", "--include-untracked", "-m", "workbench clear"]);
  git(["-C", dir, "checkout", branch]);
  git(["-C", dir, "pull", "--ff-only"]);
}

export function run(args, env) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  if (positionals.length > 1) usageFail("clear takes at most one repo");
  const { root, manifest } = openWorkbench(env);
  const targets = [
    ...(isCheckout(root) ? [{ id: "root", dir: root, branch: manifest.defaults.branch }] : []),
    ...manifest.repos.map((r) => ({ id: r.path, dir: r.absPath, branch: r.branch })),
  ];

  const [name] = positionals;
  if (name) {
    const id = name === "root" ? "root" : findRepo(manifest, name)?.path;
    const target = targets.find((t) => t.id === id);
    if (!target) fail(`unknown clear target "${name}"; expected one of: ${targets.map((t) => t.id).join(", ")}`);
    if (!isCheckout(target.dir)) fail(`[${target.id}] ${target.dir} is not a git checkout, nothing to clear`);
    console.log(`[${target.id}] stashing local changes, switching to ${target.branch}, pulling...`);
    if (attempt(newResults(), target.id, () => clearRepo(target.dir, target.branch))) {
      console.log(`\n[${target.id}] clean.`);
    }
    return;
  }

  const results = newResults();
  for (const target of targets) {
    if (!isCheckout(target.dir)) {
      results.skipped.push(target.id);
      continue;
    }
    attempt(results, target.id, () => {
      console.log(`[${target.id}] stashing local changes, switching to ${target.branch}, pulling...`);
      clearRepo(target.dir, target.branch);
    });
  }
  printSummary(results, "not cloned");
}
