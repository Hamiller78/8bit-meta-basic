#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runLaunchC64Cli } from "./lib/launch-c64.mjs";

export * from "./lib/launch-c64.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runLaunchC64Cli();
}
