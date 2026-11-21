// Keeps a managed block in the workbench root's .gitignore listing every
// directory wb spawns, so checkouts never get committed to the root repo.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BLOCK_START = "# >>> workbench: managed by `wb`, edits inside this block are overwritten >>>";
export const BLOCK_END = "# <<< workbench <<<";

export function managedEntries(manifest) {
  return [...new Set([...manifest.repos.map((r) => `/${r.path}/`), `/${manifest.pods.dir}/`, "*.reset-tmp/"])];
}

export function renderGitignore(existing, entries) {
  const block = [BLOCK_START, ...entries, BLOCK_END].join("\n");
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END, start);
  if (start !== -1 && end !== -1) {
    return existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);
  }
  const rest = existing.replace(/^\n+/, "");
  return rest ? `${block}\n\n${rest}` : `${block}\n`;
}

// Returns true if .gitignore changed (or would change, with dryRun).
export function syncGitignore(manifest, { dryRun = false } = {}) {
  const file = join(manifest.root, ".gitignore");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const next = renderGitignore(existing, managedEntries(manifest));
  if (next === existing) return false;
  if (!dryRun) writeFileSync(file, next);
  return true;
}
