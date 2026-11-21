import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findRepo, normalizeManifest } from "../src/manifest.js";
import { toHttps } from "../src/git.js";
import { rewritePodEnv, setEnvVar, isEnvFile } from "../src/env.js";
import { renderGitignore, BLOCK_START, BLOCK_END } from "../src/gitignore.js";
import { installCommand } from "../src/repos.js";
import { idFromUrl } from "../src/commands/add.js";

const ROOT = "/tmp/wb-root";
const repo = (over = {}) => ({ id: "a", url: "git@github.com:o/a.git", path: "a", ...over });
const norm = (raw) => normalizeManifest(raw, ROOT);

test("manifest: defaults fill in and match the old hardcoded behaviour", () => {
  const m = norm({ repos: [repo()] });
  assert.equal(m.version, 1);
  assert.equal(m.pods.dir, "pods");
  assert.equal(m.pods.absDir, join(ROOT, "pods"));
  assert.deepEqual([m.pods.portBase, m.pods.blockSize], [5000, 10]);
  assert.deepEqual(m.killPort.defaults, ["3000-3999", "4000-4999", "5000-5999"]);
  const [r] = m.repos;
  assert.equal(r.branch, "main");
  assert.equal(r.install, "auto");
  assert.deepEqual(r.carry, [".env"]);
  assert.deepEqual(r.pod, { prefix: "a-", ports: [] });
  assert.equal(r.absPath, join(ROOT, "a"));
});

test("manifest: per-repo settings override defaults", () => {
  const m = norm({
    defaults: { branch: "develop", install: "pnpm" },
    repos: [repo({ branch: "trunk", install: false, carry: [".env", ".env.local"], pod: { prefix: "p" } })],
  });
  const [r] = m.repos;
  assert.deepEqual([r.branch, r.install, r.carry, r.pod.prefix], ["trunk", false, [".env", ".env.local"], "p"]);
});

test("manifest: rejects paths that escape or collide", () => {
  const bad = [
    [{ repos: [repo({ path: "../x" })] }, /must not contain "\.\."/],
    [{ repos: [repo({ path: "/abs" })] }, /relative path/],
    [{ repos: [repo({ path: "." })] }, /inside the workbench root, not at it/],
    [{ repos: [repo({ path: "x/../.." })] }, /must not contain/],
    [{ repos: [repo(), repo({ id: "b" })] }, /already used/],
    [{ repos: [repo(), repo({ id: "b", path: "a/b" })] }, /nested/],
    [{ repos: [repo({ path: "pods" })] }, /overlaps the pods directory/],
    [{ pods: { dir: "../pods" }, repos: [] }, /pods\.dir/],
    [{ repos: [repo({ carry: ["../.env"] })] }, /carry/],
  ];
  for (const [raw, re] of bad) assert.throws(() => norm(raw), re, JSON.stringify(raw));
});

test("manifest: rejects unsafe names and values", () => {
  const bad = [
    [{ version: 2, repos: [] }, /version 2/],
    [{ repos: [repo({ id: "a/b" })] }, /"id"/],
    [{ repos: [repo({ id: ".." })] }, /"id"/],
    [{ repos: [repo({ url: "--upload-pack=evil" })] }, /"url"/],
    [{ repos: [repo({ branch: "-x" })] }, /"branch"/],
    [{ repos: [repo({ install: "make" })] }, /"install"/],
    [{ repos: [repo({ install: ["--evil"] })] }, /"install"/],
    [{ repos: [repo({ pod: { prefix: "a1" } })] }, /not end in a digit/],
    [{ repos: [repo({ pod: { ports: [{ key: "BAD KEY" }] } })] }, /env var name/],
    [{ repos: [repo(), repo({ id: "b", path: "b", pod: { prefix: "a-" } })] }, /share the pod prefix/],
    [{ killPort: { defaults: ["abc"] }, repos: [] }, /killPort/],
    [{ pods: { blockSize: 1 }, repos: [repo({ pod: { ports: [{ key: "A" }, { key: "B" }] } })] }, /blockSize/],
  ];
  for (const [raw, re] of bad) assert.throws(() => norm(raw), re, JSON.stringify(raw));
});

test("manifest: legacy entries may reuse an id and the prefix", () => {
  const m = norm({ repos: [repo(), repo({ path: "a-legacy", legacy: true })] });
  assert.equal(findRepo(m, "a").path, "a");
  assert.equal(findRepo(m, "a-legacy").path, "a-legacy");
  assert.equal(findRepo(m, "nope"), undefined);
});

test("toHttps rewrites SSH remotes for any host", () => {
  assert.equal(toHttps("git@github.com:sovereignfs/fjord"), "https://github.com/sovereignfs/fjord.git");
  assert.equal(toHttps("git@github.com:o/r.git"), "https://github.com/o/r.git");
  assert.equal(toHttps("git@gitlab.example.com:group/sub/r.git"), "https://gitlab.example.com/group/sub/r.git");
  assert.equal(toHttps("ssh://git@host.example:2222/o/r.git"), "https://host.example/o/r.git");
  assert.equal(toHttps("https://github.com/o/r.git"), "https://github.com/o/r.git");
  assert.equal(toHttps("/local/path/r.git"), "/local/path/r.git");
});

test("setEnvVar replaces, uncomments, appends and escapes", () => {
  assert.equal(setEnvVar("A=1\nB=2\n", "A", 9), "A=9\nB=2\n");
  assert.equal(setEnvVar("# A=1\n", "A", 9), "A=9\n");
  assert.equal(setEnvVar("B=2\n", "A", 9), "B=2\nA=9\n");
  // "." in a key must not act as a regex wildcard
  assert.equal(setEnvVar("AXB=1\n", "A.B", 2), "AXB=1\nA.B=2\n");
  // "$&" in a value is literal
  assert.equal(setEnvVar("A=1\n", "A", "$&x"), "A=$&x\n");
});

test("rewritePodEnv assigns a port block and rewrites URLs in one pass", () => {
  const ports = [
    { key: "RUNTIME_PORT", default: 3000 },
    { key: "AUTH_PORT", default: 3001 },
  ];
  const env = "# RUNTIME_PORT=3000\nAUTH_URL=http://localhost:3001/auth\nAPP=http://127.0.0.1:3000\nOTHER=localhost:30001\n";
  assert.equal(
    rewritePodEnv(env, ports, 5010),
    "RUNTIME_PORT=5010\nAUTH_URL=http://localhost:5011/auth\nAPP=http://127.0.0.1:5010\nOTHER=localhost:30001\nAUTH_PORT=5011\n"
  );
  // a new port equal to another var's default isn't rewritten twice
  const chained = [
    { key: "A", default: 5000 },
    { key: "B", default: 5001 },
  ];
  assert.equal(rewritePodEnv("X=localhost:5000 localhost:5001\n", chained, 5001), "X=localhost:5001 localhost:5002\nA=5001\nB=5002\n");
  assert.ok(isEnvFile(".env") && isEnvFile("apps/web/.env.local") && !isEnvFile("env.js"));
});

test("renderGitignore inserts, then replaces, the managed block", () => {
  const first = renderGitignore("node_modules/\n", ["/a/", "/pods/"]);
  assert.equal(first, `${BLOCK_START}\n/a/\n/pods/\n${BLOCK_END}\n\nnode_modules/\n`);
  const second = renderGitignore(first, ["/a/", "/b/", "/pods/"]);
  assert.equal(second, `${BLOCK_START}\n/a/\n/b/\n/pods/\n${BLOCK_END}\n\nnode_modules/\n`);
  assert.equal(renderGitignore("", ["/a/"]), `${BLOCK_START}\n/a/\n${BLOCK_END}\n`);
});

test("installCommand picks the right installer", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wb-install-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(installCommand("auto", dir), null, "no package.json");
  assert.equal(installCommand("pnpm", dir), null, "no package.json");
  assert.deepEqual(installCommand(["make", "setup"], dir), ["make", "setup"]);
  writeFileSync(join(dir, "package.json"), "{}");
  assert.deepEqual(installCommand("auto", dir), ["npm", "install"]);
  assert.deepEqual(installCommand("pnpm", dir), ["pnpm", "install"]);
  assert.equal(installCommand(false, dir), null);
  writeFileSync(join(dir, "package.json"), '{"packageManager":"yarn@4.1.0"}');
  assert.deepEqual(installCommand("auto", dir), ["yarn", "install"]);
  writeFileSync(join(dir, "pnpm-lock.yaml"), "");
  assert.deepEqual(installCommand("auto", dir), ["pnpm", "install"]);
});

test("idFromUrl", () => {
  assert.equal(idFromUrl("git@github.com:o/repo.git"), "repo");
  assert.equal(idFromUrl("https://github.com/o/repo/"), "repo");
  assert.equal(idFromUrl("/srv/git/thing.git"), "thing");
});
