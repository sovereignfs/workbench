import { existsSync, mkdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MANIFEST_FILE } from "../root.js";
import { BUILTIN, MANIFEST_VERSION, SCHEMA_URL, normalizeManifest, writeRawManifest } from "../manifest.js";
import { syncGitignore } from "../gitignore.js";
import { fail, usageFail } from "../util.js";

export const usage = `wb new [dir] [--name <name>]
    Start a workbench in dir (default: the current directory): write a starter
    ${MANIFEST_FILE} and the managed .gitignore block. Refuses if a
    manifest is already there.`;

export function run(args, env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: "string" } },
  });
  if (positionals.length > 1) usageFail("new takes at most one directory");
  const cwd = env.cwd ?? process.cwd();
  const dir = resolve(cwd, positionals[0] ?? ".");
  if (existsSync(join(dir, MANIFEST_FILE))) fail(`${join(dir, MANIFEST_FILE)} already exists`);

  const raw = {
    $schema: SCHEMA_URL,
    version: MANIFEST_VERSION,
    name: values.name ?? basename(dir),
    defaults: { ...BUILTIN.defaults },
    pods: { ...BUILTIN.pods },
    repos: [],
  };
  const manifest = normalizeManifest(raw, dir);
  mkdirSync(dir, { recursive: true });
  writeRawManifest(dir, raw);
  syncGitignore(manifest);

  const where = relative(cwd, dir) || ".";
  console.log(`Created ${join(where, MANIFEST_FILE)} and ${join(where, ".gitignore")}.

Next:
  wb add git@github.com:you/repo.git    add repos to the manifest
  wb init                               clone them all`);
}
