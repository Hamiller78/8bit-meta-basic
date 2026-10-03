#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runScaffoldProjectCli } from "./lib/scaffold-project.mjs";

export * from "./lib/scaffold-project.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runScaffoldProjectCli();
}
