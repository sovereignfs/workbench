// Pods: fully independent clones of one repo for concurrent work, under the
// manifest's pods dir, named <prefix><n> with their own block of ports.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { findRepo, isSafeName } from "../manifest.js";
import { cloneRepo, currentBranch, isCheckout, localWorkProblems } from "../git.js";
import { isEnvFile, podPortBase, rewritePodEnv } from "../env.js";
import { carryFiles, installCommand, openWorkbench, repoUrl } from "../repos.js";
import { attempt, escapeRegExp, fail, newResults, printSummary, printTable, usageFail } from "../util.js";

export const usage = `wb pod create <repo>... [--https]
    Create an isolated pod of each repo (any non-legacy one): fresh clone into
    <pods.dir>/<prefix><n>, "carry" files copied from the main checkout with
    pod.ports rewritten to the pod's port block in .env files, then install.
wb pod list
    List pods with their repo, branch, local work and port block.
wb pod remove <pod>... [--force]
    Delete pods. Refuses if a pod has uncommitted, unpushed or stashed work
    unless --force.`;

function prefixRe(prefix) {
  return new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
}

function podDirs(manifest) {
  if (!existsSync(manifest.pods.absDir)) return [];
  return readdirSync(manifest.pods.absDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function nextPodIndex(manifest, prefix) {
  const re = prefixRe(prefix);
  let max = 0;
  for (const name of podDirs(manifest)) {
    const m = name.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// Which repo a pod dir belongs to, by prefix. Prefixes never end in a digit
// and are unique, so at most one repo matches.
function podOwner(manifest, name) {
  for (const repo of manifest.repos) {
    if (repo.legacy) continue;
    const m = name.match(prefixRe(repo.pod.prefix));
    if (m) return { repo, index: Number(m[1]) };
  }
  return null;
}

function createPod(manifest, name, { https }) {
  const poddable = manifest.repos.filter((r) => !r.legacy).map((r) => r.path);
  const repo = findRepo(manifest, name);
  if (!repo) fail(`unknown repo "${name}"; expected one of: ${poddable.join(", ")}`);
  if (repo.legacy) fail(`"${name}" is a legacy repo; pods aren't available for it`);

  const { pods, root } = manifest;
  const index = nextPodIndex(manifest, repo.pod.prefix);
  const podName = `${repo.pod.prefix}${index}`;
  const podDir = join(pods.absDir, podName);
  const rel = relative(root, podDir);
  if (existsSync(podDir)) fail(`${rel} already exists; refusing to overwrite`);
  const base = podPortBase(pods, index);
  const ports = repo.pod.ports;
  if (ports.length && base + pods.blockSize - 1 > 65535) {
    fail(`pod ${podName}'s port block (${base}+) is past 65535; lower pods.portBase or remove old pods`);
  }

  console.log(`[${podName}] cloning ${repo.path} into ${rel}...`);
  cloneRepo(repoUrl(repo, { https }), podDir);

  const rewritten = [];
  const copied = carryFiles(repo, repo.absPath, podDir, (file, src, dst) => {
    if (!ports.length || !isEnvFile(file) || !statSync(src).isFile()) return false;
    writeFileSync(dst, rewritePodEnv(readFileSync(src, "utf8"), ports, base));
    rewritten.push(file);
    return true;
  });
  if (copied.length) {
    console.log(`[${podName}] copied from ${repo.path}/: ${copied.join(", ")}`);
  } else if (repo.carry.length) {
    console.log(`[${podName}] nothing to copy from ${repo.path}/ (${repo.carry.join(", ")} not found)`);
  }
  if (rewritten.length) {
    const assigned = ports.map((p, i) => `${p.key}=${base + i}`).join(", ");
    console.log(`[${podName}] ports in ${rewritten.join(", ")}: ${assigned}`);
  } else if (copied.some(isEnvFile)) {
    console.log(`[${podName}] note: no pod.ports set for ${repo.path} in the manifest; copied as-is.`);
  }

  const install = installCommand(repo.install, podDir);
  if (install) {
    console.log(`[${podName}] installing dependencies (${install.join(" ")})...`);
    execFileSync(install[0], install.slice(1), { cwd: podDir, stdio: "inherit" });
  }

  console.log(`\n[${podName}] ready at ${rel}`);
}

function removePod(manifest, name, { force }) {
  if (!isSafeName(name)) fail(`"${name}" is not a pod name`);
  const dir = join(manifest.pods.absDir, name);
  const rel = relative(manifest.root, dir);
  if (!existsSync(dir)) fail(`no pod at ${rel}`);
  if (!force) {
    if (!isCheckout(dir)) fail(`${rel} is not a git checkout; re-run with --force to delete it anyway`);
    const problems = localWorkProblems(dir);
    if (problems.length) {
      fail(`${rel} has ${problems.join(", ")} that removing it would discard; re-run with --force to proceed`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`[${name}] removed ${rel}`);
}

function list(manifest) {
  const names = podDirs(manifest);
  if (!names.length) {
    console.log(`No pods in ${manifest.pods.dir}/. Create one with "wb pod create <repo>".`);
    return;
  }
  const rows = names.map((name) => {
    const dir = join(manifest.pods.absDir, name);
    const owner = podOwner(manifest, name);
    let branch = "-";
    let state = "not a git checkout";
    if (isCheckout(dir)) {
      try {
        branch = currentBranch(dir);
        const problems = localWorkProblems(dir);
        state = problems.length ? problems.join(", ") : "clean";
      } catch (err) {
        state = `error: ${err.message.split("\n")[0]}`;
      }
    }
    let ports = "-";
    if (owner?.repo.pod.ports.length) {
      const base = podPortBase(manifest.pods, owner.index);
      ports = `${base}-${base + manifest.pods.blockSize - 1}`;
    }
    return [name, owner?.repo.path ?? "?", branch, ports, state];
  });
  printTable(["POD", "REPO", "BRANCH", "PORTS", "STATE"], rows);
}

export function run(args, env) {
  const [sub, ...rest] = args;
  const options = {
    create: { https: { type: "boolean" } },
    list: {},
    ls: {},
    remove: { force: { type: "boolean" } },
    rm: { force: { type: "boolean" } },
  }[sub];
  if (!options) usageFail(sub ? `unknown pod command "${sub}"` : "pod needs a command");
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options });
  const { manifest } = openWorkbench(env);

  if (sub === "list" || sub === "ls") {
    if (positionals.length) usageFail("pod list takes no arguments");
    return list(manifest);
  }
  if (!positionals.length) usageFail(`pod ${sub} needs at least one ${sub === "create" ? "repo" : "pod"}`);
  const results = newResults();
  for (const name of positionals) {
    if (sub === "create") attempt(results, name, () => createPod(manifest, name, values), "pod create failed");
    else attempt(results, name, () => removePod(manifest, name, values), "pod remove failed");
  }
  if (positionals.length > 1) printSummary(results);
}
