import { readFileSync } from "node:fs";
import * as add from "./commands/add.js";
import * as clear from "./commands/clear.js";
import * as exec from "./commands/exec.js";
import * as gitignore from "./commands/gitignore.js";
import * as init from "./commands/init.js";
import * as killPort from "./commands/kill-port.js";
import * as newCmd from "./commands/new.js";
import * as pod from "./commands/pod.js";
import * as pull from "./commands/pull.js";
import * as status from "./commands/status.js";
import { WorkbenchError } from "./util.js";

const COMMANDS = {
  new: newCmd,
  add,
  gitignore,
  init,
  pull,
  status,
  exec,
  clear,
  pod,
  "kill-port": killPort,
};

const GROUPS = [
  ["Set up", ["new", "add", "gitignore"]],
  ["Checkouts", ["init", "pull", "status", "exec", "clear"]],
  ["Parallel work", ["pod", "kill-port"]],
];

export function version() {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
}

function indent(text) {
  return text
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

export function printUsage() {
  const sections = GROUPS.map(
    ([title, names]) => `${title}:\n${names.map((n) => indent(COMMANDS[n].usage)).join("\n")}`
  );
  console.log(`wb ${version()}: a manifest-driven multi-repo workbench

Usage: wb [--root <dir>] <command> [options]

The workbench root is --root, else $WORKBENCH_ROOT, else the nearest directory
at or above the current one containing workbench.manifest.json.

${sections.join("\n\n")}

Run "wb help <command>" for one command.`);
}

// Pulls --root out of argv (anywhere before a "--").
function extractRoot(argv) {
  const rest = [];
  let rootOpt;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    if (a === "--root") {
      rootOpt = argv[++i];
      if (rootOpt == null) throw new WorkbenchError("--root needs a directory");
    } else if (a.startsWith("--root=")) {
      rootOpt = a.slice("--root=".length);
    } else {
      rest.push(a);
    }
  }
  return { rootOpt, rest };
}

export function main(argv, { cwd = process.cwd() } = {}) {
  let command;
  try {
    const { rootOpt, rest } = extractRoot(argv);
    const [first, ...args] = rest;
    command = first;
    if (!command || command === "help" || command === "-h" || command === "--help") {
      const topic = COMMANDS[args[0]];
      if (topic) console.log(topic.usage);
      else printUsage();
      return;
    }
    if (command === "--version" || command === "-v" || command === "version") {
      console.log(version());
      return;
    }
    const cmd = COMMANDS[command];
    if (!cmd) {
      console.error(`wb: unknown command "${command}"\n`);
      printUsage();
      process.exitCode = 1;
      return;
    }
    // For exec, flags after the command belong to the command it runs.
    if (args[0] === "--help" || args[0] === "-h" || (command !== "exec" && args.some((a) => a === "--help" || a === "-h"))) {
      console.log(cmd.usage);
      return;
    }
    cmd.run(args, { rootOpt, cwd });
  } catch (err) {
    const prefix = command && COMMANDS[command] ? `wb ${command}` : "wb";
    console.error(`${prefix}: ${err.message}`);
    const parseError = typeof err.code === "string" && err.code.startsWith("ERR_PARSE_ARGS");
    if ((err instanceof WorkbenchError && err.usage) || parseError) {
      console.error(`\nUsage:\n${indent(COMMANDS[command]?.usage ?? "wb help")}`);
    } else if (!(err instanceof WorkbenchError) && process.env.WB_DEBUG) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}
