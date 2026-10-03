#!/usr/bin/env node
import { runBuildTargetCli } from "./lib/build-target.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export * from "./lib/build-target.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runBuildTargetCli();
}
