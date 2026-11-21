import { parseArgs } from "node:util";
import { cloneOrPull, openWorkbench } from "../repos.js";
import { attempt, newResults, printSummary } from "../util.js";

export const usage = `wb init [--https]
    Clone every manifest repo except "skip" entries; pull the ones already
    cloned. SSH URLs by default; --https rewrites git@host:path to https://host/path.`;

export function run(args, env) {
  const { values } = parseArgs({ args, options: { https: { type: "boolean" } } });
  const { manifest } = openWorkbench(env);
  const results = newResults();
  for (const repo of manifest.repos) {
    // "skip" entries are opt-in: `wb pull <repo> --reset` clones one.
    if (repo.skip) {
      results.skipped.push(repo.path);
      continue;
    }
    attempt(results, repo.path, () => cloneOrPull(repo, { https: values.https }));
  }
  printSummary(results);
}
