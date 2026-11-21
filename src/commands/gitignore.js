import { parseArgs } from "node:util";
import { syncGitignore } from "../gitignore.js";
import { openWorkbench } from "../repos.js";

export const usage = `wb gitignore [--check]
    Rewrite the managed .gitignore block from the manifest (every repo path,
    the pods dir, *.reset-tmp/). --check only reports, exiting 1 if it's stale.`;

export function run(args, env) {
  const { values } = parseArgs({ args, options: { check: { type: "boolean" } } });
  const { manifest } = openWorkbench(env);
  const stale = syncGitignore(manifest, { dryRun: values.check });
  if (values.check) {
    console.log(stale ? ".gitignore is out of date; run \"wb gitignore\"" : ".gitignore is up to date");
    if (stale) process.exitCode = 1;
  } else {
    console.log(stale ? "Updated .gitignore." : ".gitignore is already up to date.");
  }
}
