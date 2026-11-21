#!/usr/bin/env node
// Entry point for the `wb` / `workbench` commands. See ../README.md.
import { main } from "../src/cli.js";

main(process.argv.slice(2));
