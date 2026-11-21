import { parseArgs } from "node:util";
import { findRepo } from "../manifest.js";
import { currentBranch, gitOut, isCheckout } from "../git.js";
import { openWorkbench } from "../repos.js";
import { fail, printTable } from "../util.js";

export const usage = `wb status [<repo>...] [--fetch]
    One line per repo: current branch, uncommitted changes, stashes, and how
    far it is ahead of or behind its upstream. --fetch runs "git fetch" first.`;

function syncState(dir) {
  try {
    const [ahead, behind] = gitOut(["-C", dir, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
      .split(/\s+/)
      .map(Number);
    if (!ahead && !behind) return "up to date";
    return [ahead && `ahead ${ahead}`, behind && `behind ${behind}`].filter(Boolean).join(", ");
  } catch {
    return "no upstream";
  }
}

function repoRow(repo, { fetch }) {
  const flags = [repo.skip && "skip", repo.legacy && "legacy"].filter(Boolean).join(", ");
  if (!isCheckout(repo.absPath)) return [repo.path, "-", "-", "-", "not cloned", flags];
  const dir = repo.absPath;
  const notes = [];
  if (fetch) {
    try {
      gitOut(["-C", dir, "fetch", "--quiet"]);
    } catch {
      notes.push("fetch failed");
    }
  }
  try {
    const branch = currentBranch(dir);
    const changes = gitOut(["-C", dir, "status", "--porcelain"]).split("\n").filter(Boolean).length;
    const stashes = gitOut(["-C", dir, "stash", "list"]).split("\n").filter(Boolean).length;
    return [
      repo.path,
      branch,
      changes ? `${changes} changed` : "clean",
      stashes || "-",
      syncState(dir),
      [flags, ...notes].filter(Boolean).join(", "),
    ];
  } catch (err) {
    return [repo.path, "?", "?", "?", `error: ${err.message.split("\n")[0]}`, flags];
  }
}

export function run(args, env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { fetch: { type: "boolean" } },
  });
  const { manifest } = openWorkbench(env);
  const repos = positionals.length
    ? positionals.map((name) => findRepo(manifest, name) ?? fail(`unknown repo "${name}"`))
    : manifest.repos;
  printTable(
    ["REPO", "BRANCH", "CHANGES", "STASHES", "SYNC", "NOTES"],
    repos.map((repo) => repoRow(repo, values))
  );
}
