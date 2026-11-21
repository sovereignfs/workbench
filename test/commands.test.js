import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeFixture } from "./helpers.js";

const ok = (r) => assert.equal(r.code, 0, r.out);
const failed = (r, re) => {
  assert.equal(r.code, 1, r.out);
  if (re) assert.match(r.out, re);
};

test("init clones every non-skip repo, and re-running pulls", (t) => {
  const f = makeFixture(t, { repos: ["alpha", "beta", "gamma"], entries: { gamma: { skip: true } } });
  let r = f.run(["init"]);
  ok(r);
  assert.match(r.stdout, /done: 2 ok, 1 skipped, 0 failed \(skipped: gamma\)/);
  assert.ok(existsSync(join(f.root, "alpha", "README.md")));
  assert.ok(!existsSync(join(f.root, "gamma")));
  f.pushUpstream("alpha");
  r = f.run(["init"]);
  ok(r);
  assert.ok(existsSync(join(f.root, "alpha", "upstream.txt")));
});

test("root discovery: from a subdirectory, via --root, and with no manifest", (t) => {
  const f = makeFixture(t);
  ok(f.run(["init"]));
  const sub = join(f.root, "alpha");
  ok(f.run(["status"], { cwd: sub }));
  ok(f.run(["--root", f.root, "status"], { cwd: f.dir }));
  ok(f.run(["status"], { cwd: f.dir, extraEnv: { WORKBENCH_ROOT: f.root } }));
  failed(f.run(["status"], { cwd: f.dir }), /no workbench\.manifest\.json found/);
});

test("pull keeps local work: dirty main is stashed and re-applied", (t) => {
  const f = makeFixture(t);
  ok(f.run(["init"]));
  const alpha = join(f.root, "alpha");
  writeFileSync(join(alpha, "README.md"), "local edit\n");
  writeFileSync(join(alpha, "untracked.txt"), "mine\n");
  f.pushUpstream("alpha");
  const r = f.run(["pull", "alpha"]);
  ok(r);
  assert.equal(readFileSync(join(alpha, "README.md"), "utf8"), "local edit\n");
  assert.ok(existsSync(join(alpha, "untracked.txt")));
  assert.ok(existsSync(join(alpha, "upstream.txt")));
  assert.match(f.gitIn(alpha, "stash", "list"), /workbench pull/, "stash entry kept as a safety net");
});

test("pull on a feature branch fast-forwards main without touching the tree", (t) => {
  const f = makeFixture(t);
  ok(f.run(["init"]));
  const alpha = join(f.root, "alpha");
  f.gitIn(alpha, "checkout", "-q", "-b", "feature");
  f.pushUpstream("alpha");
  const r = f.run(["pull", "--all"]);
  ok(r);
  assert.match(r.stdout, /working tree left on "feature"/);
  assert.equal(f.gitIn(alpha, "rev-parse", "--abbrev-ref", "HEAD"), "feature");
  assert.ok(!existsSync(join(alpha, "upstream.txt")));
  assert.equal(f.gitIn(alpha, "rev-parse", "main"), f.gitIn(alpha, "rev-parse", "origin/main"));
});

test("pull argument errors and unknown/uncloned repos", (t) => {
  const f = makeFixture(t, { entries: { beta: { skip: true } } });
  failed(f.run(["pull"]), /either --all or exactly one repo/);
  failed(f.run(["pull", "--all", "--reset"]), /one repo at a time/);
  failed(f.run(["pull", "nope"]), /unknown repo "nope"/);
  failed(f.run(["pull", "beta"]), /not cloned.*"skip"/);
  failed(f.run(["pull", "--bogus"]), /Unknown option/);
});

test("pull --reset clones a skip repo, refuses to discard work, carries .env", (t) => {
  const f = makeFixture(t, { entries: { beta: { skip: true } } });
  ok(f.run(["pull", "beta", "--reset"]));
  const beta = join(f.root, "beta");
  assert.ok(existsSync(join(beta, "README.md")));

  writeFileSync(join(beta, ".env"), "SECRET=1\n");
  f.gitIn(beta, "commit", "-q", "--allow-empty", "-m", "local only");
  failed(f.run(["pull", "beta", "--reset"]), /commits not on any remote.*--force/);
  assert.ok(existsSync(join(beta, ".env")), "nothing deleted on refusal");

  ok(f.run(["pull", "beta", "--reset", "--force"]));
  assert.equal(readFileSync(join(beta, ".env"), "utf8"), "SECRET=1\n");
  assert.equal(f.gitIn(beta, "log", "--branches", "--not", "--remotes", "--oneline"), "");
  assert.ok(!existsSync(`${beta}.reset-tmp`));
});

test("pull --reset refuses to replace a non-checkout directory", (t) => {
  const f = makeFixture(t);
  mkdirSync(join(f.root, "alpha"));
  writeFileSync(join(f.root, "alpha", "precious.txt"), "x");
  failed(f.run(["pull", "alpha", "--reset", "--force"]), /not a git checkout/);
  assert.ok(existsSync(join(f.root, "alpha", "precious.txt")));
});

test("legacy repos: init clones them, bare id resolves to the non-legacy entry, no pods", (t) => {
  const f = makeFixture(t, { repos: ["alpha", "old"] });
  const m = f.readManifest();
  m.repos[1] = { ...m.repos[1], id: "alpha", legacy: true };
  f.writeManifest(m);
  ok(f.run(["init"]));
  failed(f.run(["pod", "create", "old"]), /legacy repo/);
  const r = f.run(["pod", "create", "alpha"]);
  ok(r);
  assert.ok(existsSync(join(f.root, "pods", "alpha-1")));
});

test("clear stashes local changes and returns to a clean branch", (t) => {
  const f = makeFixture(t);
  ok(f.run(["init"]));
  const alpha = join(f.root, "alpha");
  f.gitIn(alpha, "checkout", "-q", "-b", "wip");
  writeFileSync(join(alpha, "scratch.txt"), "x");
  failed(f.run(["clear", "nope"]), /unknown clear target/);
  ok(f.run(["clear", "alpha"]));
  assert.equal(f.gitIn(alpha, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.ok(!existsSync(join(alpha, "scratch.txt")));
  assert.match(f.gitIn(alpha, "stash", "list"), /workbench clear/);
  // no-arg clear: root is not a checkout here, so only repos are cleared
  const r = f.run(["clear"]);
  ok(r);
  assert.match(r.stdout, /done: 2 ok, 0 not cloned, 0 failed/);
});

test("pod create: prefix, .env port rewrite, install command, list, remove", (t) => {
  const f = makeFixture(t, {
    manifest: { pods: { dir: "pods", portBase: 6000, blockSize: 5 } },
    entries: {
      alpha: {
        pod: { prefix: "p", ports: [{ key: "RUNTIME_PORT", default: 3000 }, { key: "AUTH_PORT", default: 3001 }] },
        install: [process.execPath, "-e", "require('fs').writeFileSync('installed.txt','ok')"],
      },
    },
  });
  ok(f.run(["init"]));
  writeFileSync(join(f.root, "alpha", ".env"), "RUNTIME_PORT=3000\nAUTH_URL=http://localhost:3001\n");

  let r = f.run(["pod", "create", "alpha", "beta"]);
  ok(r);
  assert.match(r.stdout, /done: 2 ok/);
  ok(f.run(["pod", "create", "alpha"]));

  const p1 = join(f.root, "pods", "p1");
  const p2 = join(f.root, "pods", "p2");
  assert.equal(
    readFileSync(join(p1, ".env"), "utf8"),
    "RUNTIME_PORT=6000\nAUTH_URL=http://localhost:6001\nAUTH_PORT=6001\n"
  );
  assert.match(readFileSync(join(p2, ".env"), "utf8"), /RUNTIME_PORT=6005/);
  assert.equal(readFileSync(join(p1, "installed.txt"), "utf8"), "ok");
  assert.ok(existsSync(join(f.root, "pods", "beta-1", "README.md")));
  assert.ok(!existsSync(join(f.root, "pods", "beta-1", "installed.txt")), "beta has install: false");

  r = f.run(["pod", "list"]);
  ok(r);
  assert.match(r.stdout, /p1\s+alpha\s+main\s+6000-6004\s+uncommitted changes/);
  assert.match(r.stdout, /p2\s+alpha\s+main\s+6005-6009/);
  assert.match(r.stdout, /beta-1\s+beta\s+main\s+-\s+clean/);

  // p1 has an untracked .env → refused without --force
  failed(f.run(["pod", "remove", "p1"]), /uncommitted changes.*--force/);
  assert.ok(existsSync(p1));
  ok(f.run(["pod", "remove", "p1", "--force"]));
  assert.ok(!existsSync(p1));
  ok(f.run(["pod", "remove", "beta-1"]));
  failed(f.run(["pod", "remove", "../alpha"]), /not a pod name/);
  failed(f.run(["pod", "remove", "nope"]), /no pod at/);
  assert.ok(existsSync(join(f.root, "alpha")));

  // numbering continues after the highest existing pod
  ok(f.run(["pod", "create", "alpha"]));
  assert.ok(existsSync(join(f.root, "pods", "p3")));
});

test("pod remove refuses unpushed commits", (t) => {
  const f = makeFixture(t);
  ok(f.run(["pod", "create", "alpha"]));
  const pod = join(f.root, "pods", "alpha-1");
  f.gitIn(pod, "commit", "-q", "--allow-empty", "-m", "local");
  failed(f.run(["pod", "remove", "alpha-1"]), /commits not on any remote/);
  assert.ok(existsSync(pod));
});

test("status reports branch, changes and sync state", (t) => {
  const f = makeFixture(t, { entries: { beta: { skip: true } } });
  ok(f.run(["init"]));
  const alpha = join(f.root, "alpha");
  writeFileSync(join(alpha, "new.txt"), "x");
  f.pushUpstream("alpha");
  let r = f.run(["status"]);
  ok(r);
  assert.match(r.stdout, /alpha\s+main\s+1 changed\s+-\s+up to date/);
  assert.match(r.stdout, /beta\s+-\s+-\s+-\s+not cloned\s+skip/);
  r = f.run(["status", "alpha", "--fetch"]);
  ok(r);
  assert.match(r.stdout, /behind 1/);
  assert.doesNotMatch(r.stdout, /beta/);
});

test("exec runs in each cloned repo and continues past failures", (t) => {
  const f = makeFixture(t, { repos: ["alpha", "beta", "gamma"], entries: { gamma: { skip: true } } });
  ok(f.run(["init"]));
  writeFileSync(join(f.root, "beta", "marker"), "");
  let r = f.run(["exec", "--", process.execPath, "-e", "process.exit(require('fs').existsSync('marker') ? 3 : 0)"]);
  failed(r);
  assert.match(r.out, /done: 1 ok, 1 not cloned, 1 failed \(not cloned: gamma\) \(failed: beta\)/);

  r = f.run(["exec", "--only", "alpha", "git", "rev-parse", "--abbrev-ref", "HEAD"]);
  ok(r);
  assert.match(r.stdout, /\[alpha\] \$ git rev-parse/);
  assert.match(r.stdout, /done: 1 ok, 0 not cloned, 0 failed/);
  failed(f.run(["exec"]), /needs a command/);
  failed(f.run(["exec", "--only", "nope", "--", "true"]), /unknown repo "nope"/);
});

test("new + add + gitignore", (t) => {
  const f = makeFixture(t);
  const fresh = join(f.dir, "fresh");
  let r = f.run(["new", fresh, "--name", "demo"], { cwd: f.dir });
  ok(r);
  failed(f.run(["new", fresh], { cwd: f.dir }), /already exists/);
  const manifest = JSON.parse(readFileSync(join(fresh, "workbench.manifest.json"), "utf8"));
  assert.equal(manifest.name, "demo");
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.repos, []);

  r = f.run(["add", f.remote("alpha"), "--clone"], { cwd: fresh });
  ok(r);
  assert.ok(existsSync(join(fresh, "alpha", "README.md")));
  r = f.run(["add", f.remote("beta"), "--path", "libs/beta", "--type", "lib", "--skip"], { cwd: fresh });
  ok(r);
  failed(f.run(["add", f.remote("alpha")], { cwd: fresh }), /already used/);
  failed(f.run(["add", f.remote("alpha"), "--path", "../escape"], { cwd: fresh }), /must not contain/);

  const repos = JSON.parse(readFileSync(join(fresh, "workbench.manifest.json"), "utf8")).repos;
  assert.deepEqual(
    repos.map((r) => [r.id, r.path, r.type, r.skip]),
    [
      ["alpha", "alpha", undefined, undefined],
      ["beta", "libs/beta", "lib", true],
    ]
  );
  const gi = readFileSync(join(fresh, ".gitignore"), "utf8");
  assert.match(gi, /^\/alpha\/$/m);
  assert.match(gi, /^\/libs\/beta\/$/m);
  assert.match(gi, /^\/pods\/$/m);

  ok(f.run(["gitignore", "--check"], { cwd: fresh }));
  writeFileSync(join(fresh, ".gitignore"), "node_modules/\n");
  failed(f.run(["gitignore", "--check"], { cwd: fresh }), /out of date/);
  ok(f.run(["gitignore"], { cwd: fresh }));
  assert.match(readFileSync(join(fresh, ".gitignore"), "utf8"), /\/alpha\/[\s\S]*node_modules\//);
});

test("invalid manifests fail before touching anything", (t) => {
  const f = makeFixture(t);
  const m = f.readManifest();
  m.repos[0].path = "../outside";
  f.writeManifest(m);
  failed(f.run(["init"]), /must not contain "\.\."/);
  assert.ok(!existsSync(join(f.dir, "outside")));
  writeFileSync(join(f.root, "workbench.manifest.json"), "{ nope");
  failed(f.run(["status"]), /not valid JSON/);
});

test("help, version, unknown commands, kill-port validation", (t) => {
  const f = makeFixture(t);
  let r = f.run([]);
  ok(r);
  assert.match(r.stdout, /Usage: wb/);
  r = f.run(["help", "pod"]);
  ok(r);
  assert.match(r.stdout, /wb pod create/);
  r = f.run(["pull", "--help"]);
  ok(r);
  assert.match(r.stdout, /wb pull --all/);
  assert.match(f.run(["--version"]).stdout, /^\d+\.\d+\.\d+/);
  failed(f.run(["frobnicate"]), /unknown command "frobnicate"/);
  failed(f.run(["kill-port", "abc"]), /invalid port spec/);
});
