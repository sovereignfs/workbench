// .env rewriting for pods: each pod gets its own block of ports.

import { escapeRegExp } from "./util.js";

// Sets "KEY=value" in .env content, replacing an existing line for KEY
// (commented or not, so a defaulted-but-commented var gets turned on) or
// appending a new one if the key isn't there at all.
export function setEnvVar(content, key, value) {
  const re = new RegExp(`^#?\\s*${escapeRegExp(key)}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(content)) return content.replace(re, () => line);
  return content.replace(/\n?$/, `\n${line}\n`);
}

// First port of pod <index>'s block (index starts at 1).
export function podPortBase(pods, index) {
  return pods.portBase + (index - 1) * pods.blockSize;
}

// Assigns ports[i] the port base + i, and rewrites literal
// "localhost:<default>" / "127.0.0.1:<default>" references to match. The
// rewrite is a single pass, so a new port that equals another var's default
// isn't rewritten twice.
export function rewritePodEnv(content, ports, base) {
  let out = content;
  const remap = new Map();
  ports.forEach(({ key, default: def }, i) => {
    const port = base + i;
    out = setEnvVar(out, key, port);
    if (def != null && def !== port) remap.set(String(def), String(port));
  });
  if (!remap.size) return out;
  const re = new RegExp(`\\b(localhost|127\\.0\\.0\\.1):(${[...remap.keys()].join("|")})(?!\\d)`, "g");
  return out.replace(re, (_, host, port) => `${host}:${remap.get(port)}`);
}

export function isEnvFile(file) {
  return /(^|\/)\.env[^/]*$/.test(file);
}
