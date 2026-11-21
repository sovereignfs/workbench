// Operations on a manifest repo's main checkout.

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRoot } from "./root.js";
import { loadManifest } from "./manifest.js";
import { cloneRepo, currentBranch, git, gitOut, isCheckout, localWorkProblems, toHttps } from "./git.js";
import { fail } from "./util.js";

export function openWorkbench(env = {}) {
  const root = findRoot({ root: env.rootOpt, cwd: env.cwd });
  return { root, manifest: loadManifest(root) };
}

export function repoUrl(repo, { https } = {}) {
  return https ? toHttps(repo.url) : repo.url;
}

export function cloneOrPull(repo, { https }) {
  if (isCheckout(repo.absPath)) {
    console.log(`[${repo.path}] already cloned, pulling...`);
    git(["-C", repo.absPath, "pull", "--ff-only"]);
  } else {
    console.log(`[${repo.path}] cloning into ${repo.path}...`);
    cloneRepo(repoUrl(repo, { https }), repo.absPath);
  }
}

// Brings a checkout's local <branch> up to date with origin, fast-forward only.
// - On <branch>: stash anything in the working tree (untracked included),
//   pull, then `stash apply` so the changes come back. The stash entry is
//   kept (apply, not pop) so nothing is lost if the apply conflicts.
// - On another branch: fast-forward the local <branch> ref directly with
//   `fetch origin <branch>:<branch>`. The working tree isn't touched.
export function pullBranch(dir, branch) {
  const current = currentBranch(dir);
  if (current !== branch) {
    git(["-C", dir, "fetch", "origin", `${branch}:${branch}`]);
    console.log(`  ${branch} updated; working tree left on "${current}".`);
    return;
  }
  const dirty = gitOut(["-C", dir, "status", "--porcelain"]) !== "";
  if (dirty) {
    console.log("  working tree has changes, stashing...");
    git(["-C", dir, "stash", "push", "--include-untracked", "-m", "workbench pull"]);
  }
  try {
    git(["-C", dir, "pull", "--ff-only"]);
  } finally {
    if (dirty) {
      try {
        git(["-C", dir, "stash", "apply"]);
      } catch {
        throw new Error(
          'pulled, but "git stash apply" hit conflicts; your changes are still in the stash ("git stash list")'
        );
      }
    }
  }
}

// Copies the repo's "carry" files (e.g. .env) from one checkout to another,
// leaving any the destination already has alone. Returns the ones copied.
export function carryFiles(repo, fromDir, toDir, transform) {
  const copied = [];
  for (const file of repo.carry) {
    const src = join(fromDir, file);
    const dst = join(toDir, file);
    if (!existsSync(src) || existsSync(dst)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    if (!transform?.(file, src, dst)) cpSync(src, dst, { recursive: true });
    copied.push(file);
  }
  return copied;
}

// Replaces a checkout with a fresh clone. The new clone is made beside the
// old one first, so a failed clone never costs you the existing checkout.
// Refuses to discard local work (uncommitted changes, commits not on any
// remote, stashes) unless force. "carry" files (.env by default) come along.
export function resetRepo(repo, { https, force }) {
  const dest = repo.absPath;
  const tmp = `${dest}.reset-tmp`;
  const exists = existsSync(dest);
  const isRepo = isCheckout(dest);

  if (exists && !isRepo) fail(`${repo.path}/ exists but is not a git checkout; refusing to replace it`);
  if (isRepo && !force) {
    const problems = localWorkProblems(dest);
    if (problems.length) {
      fail(
        `${repo.path}/ has ${problems.join(", ")} that a fresh clone would discard; re-run with --force to proceed`
      );
    }
  }

  console.log(`[${repo.path}] cloning a fresh copy...`);
  rmSync(tmp, { recursive: true, force: true });
  cloneRepo(repoUrl(repo, { https }), tmp);

  let carried = [];
  if (isRepo) {
    carried = carryFiles(repo, dest, tmp);
    rmSync(dest, { recursive: true, force: true });
  }
  renameSync(tmp, dest);
  console.log(
    `[${repo.path}] fresh clone ready${carried.length ? ` (carried over: ${carried.join(", ")})` : ""}.`
  );
}

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

// The argv to install dependencies in dir, or null for none.
// - false: never install
// - ["cmd", ...args]: always run that command
// - "pnpm" | "npm" | "yarn" | "bun": "<pm> install", if there's a package.json
// - "auto": like the above, picking the manager from the lockfile, then
//   package.json "packageManager", then npm
export function installCommand(install, dir) {
  if (install === false) return null;
  if (Array.isArray(install)) return install;
  if (!existsSync(join(dir, "package.json"))) return null;
  if (install !== "auto") return [install, "install"];
  const lock = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
  if (lock) return [lock[1], "install"];
  try {
    const pm = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).packageManager;
    const name = typeof pm === "string" ? pm.split("@")[0] : "";
    if (["pnpm", "yarn", "bun", "npm"].includes(name)) return [name, "install"];
  } catch {
    // unreadable package.json: fall through to npm
  }
  return ["npm", "install"];
}
