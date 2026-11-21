import { execFileSync } from "node:child_process";
import { findRepo } from "../manifest.js";
import { isCheckout } from "../git.js";
import { openWorkbench } from "../repos.js";
import { attempt, fail, newResults, printSummary, usageFail } from "../util.js";

export const usage = `wb exec [--only <repo,...>] [--include-legacy] [--] <command> [args...]
    Run a command in every cloned repo (legacy ones only with --include-legacy),
    continuing past failures. It runs without a shell: for pipes or &&, use
    "wb exec -- sh -c '...'".`;

export function run(args, env) {
  let only;
  let includeLegacy = false;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      i++;
      break;
    }
    if (a === "--only") {
      only = args[++i];
      if (only == null) usageFail("--only needs a comma-separated list of repos");
    } else if (a.startsWith("--only=")) {
      only = a.slice("--only=".length);
    } else if (a === "--include-legacy") {
      includeLegacy = true;
    } else if (a.startsWith("-")) {
      usageFail(`unknown option "${a}"; put the command after "--"`);
    } else {
      break;
    }
  }
  const command = args.slice(i);
  if (!command.length) usageFail("exec needs a command to run");

  const { manifest } = openWorkbench(env);
  const repos = only
    ? only
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => findRepo(manifest, name) ?? fail(`unknown repo "${name}"`))
    : manifest.repos.filter((r) => includeLegacy || !r.legacy);

  const results = newResults();
  for (const repo of repos) {
    if (!isCheckout(repo.absPath)) {
      results.skipped.push(repo.path);
      continue;
    }
    console.log(`\n[${repo.path}] $ ${command.join(" ")}`);
    attempt(results, repo.path, () =>
      execFileSync(command[0], command.slice(1), { cwd: repo.absPath, stdio: "inherit" })
    );
  }
  printSummary(results, "not cloned");
}
