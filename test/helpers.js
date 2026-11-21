// Test fixtures: a scratch workbench whose manifest points at local bare
// repos, and a runner for the real CLI. Never touches real remotes, and git
// runs with an empty global config so the user's settings (signing, hooks,
// default branch) can't leak in.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const BIN = fileURLToPath(new URL("../bin/workbench.js", import.meta.url));

export function makeEnv(dir) {
  const gitconfig = join(dir, "gitconfig");
  writeFileSync(gitconfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "wb test",
    GIT_AUTHOR_EMAIL: "wb@test.invalid",
    GIT_COMMITTER_NAME: "wb test",
    GIT_COMMITTER_EMAIL: "wb@test.invalid",
    GIT_TERMINAL_PROMPT: "0",
  };
  delete env.WORKBENCH_ROOT;
  return env;
}

export function makeFixture(t, { repos = ["alpha", "beta"], manifest = {}, entries = {} } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wb-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = makeEnv(dir);
  const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();
  const gitIn = (cwd, ...args) => sh("git", args, cwd);

  const remotes = join(dir, "remotes");
  mkdirSync(remotes);
  const remote = (name) => join(remotes, `${name}.git`);
  for (const name of repos) {
    gitIn(remotes, "init", "--quiet", "--bare", "-b", "main", remote(name));
    const seed = join(dir, "seed", name);
    gitIn(dir, "clone", "--quiet", remote(name), seed);
    writeFileSync(join(seed, "README.md"), `# ${name}\n`);
    gitIn(seed, "add", ".");
    gitIn(seed, "commit", "--quiet", "-m", "seed");
    gitIn(seed, "push", "--quiet", "origin", "HEAD:main");
  }

  // Pushes a new commit to a remote, as another contributor would.
  const pushUpstream = (name, file = "upstream.txt") => {
    const seed = join(dir, "seed", name);
    writeFileSync(join(seed, file), `${Date.now()}\n`);
    gitIn(seed, "add", ".");
    gitIn(seed, "commit", "--quiet", "-m", `add ${file}`);
    gitIn(seed, "push", "--quiet", "origin", "HEAD:main");
  };

  const root = join(dir, "wb");
  mkdirSync(root);
  const writeManifest = (m) => writeFileSync(join(root, "workbench.manifest.json"), JSON.stringify(m, null, 2));
  writeManifest({
    version: 1,
    defaults: { install: false },
    ...manifest,
    repos: repos.map((name) => ({ id: name, url: remote(name), path: name, ...entries[name] })),
  });

  const run = (args, { cwd = root, extraEnv = {} } = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr };
  };

  const readManifest = () => JSON.parse(readFileSync(join(root, "workbench.manifest.json"), "utf8"));

  return { dir, root, env, run, gitIn, remote, pushUpstream, writeManifest, readManifest };
}
