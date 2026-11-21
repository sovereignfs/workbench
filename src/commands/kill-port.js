import { execFileSync } from "node:child_process";
import { findRoot } from "../root.js";
import { BUILTIN, PORT_SPEC_RE, loadManifest } from "../manifest.js";
import { fail } from "../util.js";

export const usage = `wb kill-port [spec...]
    Kill whatever is listening on the given ports or ranges, e.g. "3000",
    "3000-3002", "3001 3002 4000". Defaults to the manifest's killPort.defaults
    (3000-3999 4000-4999 5000-5999). No ownership check: it kills whatever is
    there. macOS/Linux only (uses lsof).`;

// PIDs listening on a port ("3000") or range ("3000-3002"). lsof exits 1 with
// no output when nothing matches, which isn't an error.
function pidsForSpec(spec) {
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${spec}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split("\n").filter(Boolean);
  } catch (err) {
    if (err.code === "ENOENT") fail("kill-port needs lsof, which isn't on PATH");
    if (err.status === 1 && !err.stdout?.toString().trim()) return [];
    throw err;
  }
}

export function run(args, env) {
  if (process.platform === "win32") fail("kill-port is only supported on macOS and Linux");
  let specs = args;
  if (!specs.length) {
    const root = findRoot({ root: env.rootOpt, cwd: env.cwd, optional: true });
    specs = root ? loadManifest(root).killPort.defaults : BUILTIN.killPort.defaults;
  }
  const invalid = specs.filter((s) => !PORT_SPEC_RE.test(s));
  if (invalid.length) {
    fail(`invalid port spec(s): ${invalid.join(", ")}; expected a port ("3000") or a range ("3000-3002")`);
  }

  const pids = new Set();
  for (const spec of specs) for (const pid of pidsForSpec(spec)) pids.add(pid);
  if (!pids.size) {
    console.log(`Nothing listening on: ${specs.join(", ")}`);
    return;
  }
  console.log(`Killing ${pids.size} process(es) listening on ${specs.join(", ")}: ${[...pids].join(", ")}`);
  for (const pid of pids) {
    try {
      execFileSync("kill", ["-9", pid]);
    } catch (err) {
      console.error(`pid ${pid} failed: ${err.message}`);
      process.exitCode = 1;
    }
  }
}
