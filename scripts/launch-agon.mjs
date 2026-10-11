#!/usr/bin/env node
import { runLaunchAgonCli } from "./lib/launch-agon.mjs";

export * from "./lib/launch-agon.mjs";

await runLaunchAgonCli();
