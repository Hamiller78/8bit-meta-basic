#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runBuildDirectoryCli } from "./lib/build-directory.mjs";

export * from "./lib/build-directory.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runBuildDirectoryCli();
}
