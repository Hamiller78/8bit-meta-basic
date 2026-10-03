#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runRs232CaptureCli } from "./lib/rs232-capture.mjs";

export * from "./lib/rs232-capture.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runRs232CaptureCli();
}
