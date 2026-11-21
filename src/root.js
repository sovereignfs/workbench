// Finds the workbench root: the directory holding workbench.manifest.json.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fail } from "./util.js";

export const MANIFEST_FILE = "workbench.manifest.json";

// Resolution order: an explicit --root, then $WORKBENCH_ROOT, then the
// nearest ancestor of cwd (cwd included) that holds a manifest — so wb works
// from anywhere inside the workbench, pods included.
// With optional: true, returns null instead of failing when nothing is found.
export function findRoot({ root, cwd = process.cwd(), env = process.env, optional = false } = {}) {
  const explicit = root ?? (env.WORKBENCH_ROOT || undefined);
  if (explicit) {
    const dir = resolve(cwd, explicit);
    if (!existsSync(join(dir, MANIFEST_FILE))) {
      fail(`no ${MANIFEST_FILE} in ${dir} (from ${root ? "--root" : "WORKBENCH_ROOT"})`);
    }
    return dir;
  }
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, MANIFEST_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (optional) return null;
  fail(
    `no ${MANIFEST_FILE} found in ${resolve(cwd)} or any parent — ` +
      `run "wb new" to create one, or pass --root <dir>`
  );
}
