#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runLaunchAllTargetsCli } from "./lib/launch-all-targets.mjs";

export * from "./lib/launch-all-targets.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runLaunchAllTargetsCli();
}
