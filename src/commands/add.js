import { parseArgs } from "node:util";
import { findRoot } from "../root.js";
import { findRepo, normalizeManifest, readRawManifest, writeRawManifest } from "../manifest.js";
import { syncGitignore } from "../gitignore.js";
import { cloneOrPull } from "../repos.js";
import { fail, usageFail } from "../util.js";

export const usage = `wb add <url> [--path <dir>] [--id <id>] [--type <type>] [--skip] [--clone] [--https]
    Add a repo to the manifest and its directory to the managed .gitignore
    block. id defaults to the URL's last segment, path to the id. --clone
    clones it straight away.`;

// "git@github.com:org/repo.git" → "repo"
export function idFromUrl(url) {
  return url.replace(/[/\\]+$/, "").replace(/\.git$/, "").split(/[/\\:]/).pop();
}

export function run(args, env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      path: { type: "string" },
      id: { type: "string" },
      type: { type: "string" },
      skip: { type: "boolean" },
      clone: { type: "boolean" },
      https: { type: "boolean" },
    },
  });
  if (positionals.length !== 1) usageFail("add needs exactly one repo URL");
  const [url] = positionals;
  const root = findRoot({ root: env.rootOpt, cwd: env.cwd });
  const raw = readRawManifest(root);

  const id = values.id ?? idFromUrl(url);
  if (!id) fail(`can't work out an id from "${url}"; pass --id`);
  const entry = { id, url, path: values.path ?? id };
  if (values.type) entry.type = values.type;
  if (values.skip) entry.skip = true;

  const next = { ...raw, repos: [...(Array.isArray(raw.repos) ? raw.repos : []), entry] };
  const manifest = normalizeManifest(next, root); // validates the new entry against the rest
  writeRawManifest(root, next);
  const repo = findRepo(manifest, entry.path);
  console.log(`Added ${repo.path} (${url}) to the manifest.`);
  if (syncGitignore(manifest)) console.log(`Updated .gitignore with /${repo.path}/.`);
  if (values.clone) cloneOrPull(repo, { https: values.https });
}
