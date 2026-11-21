// Loads, validates and normalises workbench.manifest.json.
//
// The manifest drives rmSync, git and child processes, so it is treated as
// untrusted input: every path must stay inside the workbench root, names
// that become directory names or regexes are restricted, and values that
// end up in git/argv can't start with "-".

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { MANIFEST_FILE } from "./root.js";
import { fail } from "./util.js";

export const MANIFEST_VERSION = 1;
export const SCHEMA_URL =
  "https://unpkg.com/@sovereignfs/workbench@0/schema/manifest.schema.json";

export const BUILTIN = {
  defaults: { branch: "main", install: "auto", carry: [".env"] },
  pods: { dir: "pods", portBase: 5000, blockSize: 10 },
  killPort: { defaults: ["3000-3999", "4000-4999", "5000-5999"] },
};

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"];
export const PORT_SPEC_RE = /^\d+(-\d+)?$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const BRANCH_RE = /^(?!-)[A-Za-z0-9._/-]+$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A name that is safe to use as a single directory name.
export function isSafeName(s) {
  return typeof s === "string" && NAME_RE.test(s) && s !== "." && s !== "..";
}

export function readRawManifest(root) {
  const file = join(root, MANIFEST_FILE);
  if (!existsSync(file)) fail(`no ${MANIFEST_FILE} in ${root}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    fail(`${file} is not valid JSON: ${err.message}`);
  }
}

export function writeRawManifest(root, raw) {
  writeFileSync(join(root, MANIFEST_FILE), `${JSON.stringify(raw, null, 2)}\n`);
}

export function loadManifest(root) {
  return normalizeManifest(readRawManifest(root), root);
}

// Resolves a user-supplied repo name. Matches on the local path first — it's
// unique, unlike `id` (a legacy entry may reuse another entry's id) — then
// falls back to the id of a non-legacy entry.
export function findRepo(manifest, name) {
  return (
    manifest.repos.find((r) => r.path === name) ??
    manifest.repos.find((r) => r.id === name && !r.legacy)
  );
}

export function normalizeManifest(raw, root) {
  if (!isObject(raw)) fail(`${MANIFEST_FILE} must contain a JSON object`);
  const version = raw.version ?? MANIFEST_VERSION;
  if (version !== MANIFEST_VERSION) {
    fail(
      `${MANIFEST_FILE} has version ${JSON.stringify(version)}; ` +
        `this wb understands version ${MANIFEST_VERSION} — upgrade @sovereignfs/workbench`
    );
  }
  if (raw.name != null && typeof raw.name !== "string") fail(`"name" must be a string`);

  const defaults = { ...BUILTIN.defaults, ...optionalObject(raw.defaults, `"defaults"`) };
  checkRepoSettings(defaults, `"defaults"`);

  const podsRaw = { ...BUILTIN.pods, ...optionalObject(raw.pods, `"pods"`) };
  const podsDir = checkRelPath(podsRaw.dir, `"pods.dir"`, root);
  checkInt(podsRaw.portBase, `"pods.portBase"`, 1, 65535);
  checkInt(podsRaw.blockSize, `"pods.blockSize"`, 1, 1000);
  const pods = {
    dir: podsDir.rel,
    absDir: podsDir.abs,
    portBase: podsRaw.portBase,
    blockSize: podsRaw.blockSize,
  };

  const killPortRaw = { ...BUILTIN.killPort, ...optionalObject(raw.killPort, `"killPort"`) };
  if (
    !Array.isArray(killPortRaw.defaults) ||
    !killPortRaw.defaults.every((s) => typeof s === "string" && PORT_SPEC_RE.test(s))
  ) {
    fail(`"killPort.defaults" must be an array of ports ("3000") or ranges ("3000-3999")`);
  }

  if (!Array.isArray(raw.repos)) fail(`"repos" must be an array`);
  const repos = raw.repos.map((entry, i) => normalizeRepo(entry, i, { root, defaults, pods }));

  // Cross-entry checks: unique, non-nested paths that stay clear of the pods
  // dir, and pod prefixes that can't produce the same pod name.
  repos.forEach((a, i) => {
    if (nests(a.path, pods.dir)) {
      fail(`${a.where} "path" "${a.path}" overlaps the pods directory "${pods.dir}"`);
    }
    repos.slice(0, i).forEach((b) => {
      if (a.path === b.path) fail(`${a.where} "path" "${a.path}" is already used by ${b.where}`);
      if (nests(a.path, b.path)) fail(`${a.where} "path" "${a.path}" is nested with ${b.where} "${b.path}"`);
      if (!a.legacy && !b.legacy && a.pod.prefix === b.pod.prefix) {
        fail(`${a.where} and ${b.where} share the pod prefix "${a.pod.prefix}" — set "pod.prefix" on one of them`);
      }
    });
  });

  return {
    root,
    name: raw.name,
    version,
    defaults,
    pods,
    killPort: { defaults: killPortRaw.defaults },
    repos,
  };
}

function normalizeRepo(entry, i, { root, defaults, pods }) {
  const where = `repos[${i}]${isObject(entry) && typeof entry.path === "string" ? ` (${entry.path})` : ""}`;
  if (!isObject(entry)) fail(`${where} must be an object`);
  if (!isSafeName(entry.id)) fail(`${where} "id" must match ${NAME_RE} (got ${JSON.stringify(entry.id)})`);
  if (typeof entry.url !== "string" || !entry.url || entry.url.startsWith("-")) {
    fail(`${where} "url" must be a git URL`);
  }
  if (entry.type != null && typeof entry.type !== "string") fail(`${where} "type" must be a string`);
  for (const flag of ["skip", "legacy"]) {
    if (entry[flag] != null && typeof entry[flag] !== "boolean") fail(`${where} "${flag}" must be true or false`);
  }
  const { rel, abs } = checkRelPath(entry.path, `${where} "path"`, root);

  const settings = {
    branch: entry.branch ?? defaults.branch,
    install: entry.install ?? defaults.install,
    carry: entry.carry ?? defaults.carry,
  };
  checkRepoSettings(settings, where);

  const pod = optionalObject(entry.pod, `${where} "pod"`);
  const prefix = pod.prefix ?? `${entry.id}-`;
  if (!isSafeName(prefix) || /\d$/.test(prefix)) {
    fail(`${where} "pod.prefix" must match ${NAME_RE} and not end in a digit (got ${JSON.stringify(prefix)})`);
  }
  const ports = pod.ports ?? [];
  if (!Array.isArray(ports)) fail(`${where} "pod.ports" must be an array`);
  ports.forEach((p, j) => {
    if (!isObject(p) || !ENV_KEY_RE.test(p.key ?? "")) {
      fail(`${where} "pod.ports[${j}].key" must be an env var name`);
    }
    if (p.default != null) checkInt(p.default, `${where} "pod.ports[${j}].default"`, 1, 65535);
  });
  if (ports.length > pods.blockSize) {
    fail(`${where} has ${ports.length} pod ports but "pods.blockSize" is ${pods.blockSize}`);
  }
  return {
    ...entry,
    where,
    path: rel,
    absPath: abs,
    skip: entry.skip === true,
    legacy: entry.legacy === true,
    ...settings,
    pod: { prefix, ports: ports.map((p) => ({ key: p.key, default: p.default })) },
  };
}

function checkRepoSettings(s, where) {
  if (typeof s.branch !== "string" || !BRANCH_RE.test(s.branch)) {
    fail(`${where} "branch" must be a branch name (got ${JSON.stringify(s.branch)})`);
  }
  const install = s.install;
  const validInstall =
    install === false ||
    install === "auto" ||
    PACKAGE_MANAGERS.includes(install) ||
    (Array.isArray(install) &&
      install.length > 0 &&
      install.every((a) => typeof a === "string") &&
      install[0] !== "" &&
      !install[0].startsWith("-"));
  if (!validInstall) {
    fail(
      `${where} "install" must be "auto", one of ${PACKAGE_MANAGERS.map((p) => `"${p}"`).join("/")}, ` +
        `false, or a command as an argv array like ["make", "setup"]`
    );
  }
  if (!Array.isArray(s.carry)) fail(`${where} "carry" must be an array of file paths`);
  s.carry.forEach((c, j) => checkRelPath(c, `${where} "carry[${j}]"`, resolve(sep, "__repo__")));
}

// A path relative to root that stays strictly inside it.
function checkRelPath(value, what, root) {
  if (typeof value !== "string" || !value.trim()) fail(`${what} must be a non-empty string`);
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) fail(`${what} "${value}" must be a relative path`);
  if (value.split(/[\\/]+/).includes("..")) fail(`${what} "${value}" must not contain ".."`);
  const abs = resolve(root, value);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail(`${what} "${value}" must point inside the workbench root, not at it`);
  }
  return { rel: rel.split(sep).join("/"), abs };
}

function nests(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function checkInt(value, what, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${what} must be an integer between ${min} and ${max}`);
  }
}

function isObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function optionalObject(v, what) {
  if (v == null) return {};
  if (!isObject(v)) fail(`${what} must be an object`);
  return v;
}
