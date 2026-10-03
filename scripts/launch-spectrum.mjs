#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runLaunchSpectrumCli } from "./lib/launch-spectrum.mjs";

export * from "./lib/launch-spectrum.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runLaunchSpectrumCli();
}
