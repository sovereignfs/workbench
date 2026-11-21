// git helpers. Always execFileSync with argument arrays — never a shell.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Runs git with output streamed to the terminal.
export function git(args) {
  execFileSync("git", args, { stdio: "inherit" });
}

// Runs git and returns trimmed stdout.
export function gitOut(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function isCheckout(dir) {
  return existsSync(join(dir, ".git"));
}

export function currentBranch(dir) {
  return gitOut(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
}

// Local work a delete or fresh clone would throw away.
export function localWorkProblems(dir) {
  const problems = [];
  if (gitOut(["-C", dir, "status", "--porcelain"])) problems.push("uncommitted changes");
  if (gitOut(["-C", dir, "log", "--branches", "--not", "--remotes", "--oneline"])) {
    problems.push("commits not on any remote");
  }
  if (gitOut(["-C", dir, "stash", "list"])) problems.push("stashed changes");
  return problems;
}

export function cloneRepo(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  git(["clone", "--", url, dest]);
}

// Rewrites SSH remotes to HTTPS, for people without SSH keys set up:
//   git@host:org/repo(.git)            → https://host/org/repo.git
//   ssh://[user@]host[:port]/org/repo  → https://host/org/repo.git
// Anything else (already HTTPS, local paths) is returned unchanged.
export function toHttps(url) {
  const m =
    url.match(/^[\w.-]+@([^:/]+):(?!\/)(.+?)(?:\.git)?\/?$/) ??
    url.match(/^ssh:\/\/(?:[\w.-]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  return m ? `https://${m[1]}/${m[2]}.git` : url;
}
