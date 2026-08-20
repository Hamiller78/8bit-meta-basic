#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProject, buildTarget, profiles, targets } from "./build-target.mjs";

function parseArgs(argv) {
  const options = {
    profile: "debug",
    allProfiles: false,
    source: "examples/colors.mbas",
    outDir: "build",
    configPath: "scripts/tools.local.json",
    runTools: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--profile") {
      options.profile = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--all-profiles") {
      options.allProfiles = true;
      continue;
    }
    if (arg === "--source") {
      options.source = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.configPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--no-tools") {
      options.runTools = false;
      continue;
    }
    throw new Error(`Unknown option "${arg}".`);
  }

  return options;
}

async function buildAll(options) {
  const selectedProfiles = options.allProfiles ? Object.keys(profiles) : [options.profile];

  for (const profile of selectedProfiles) {
    if (!Object.hasOwn(profiles, profile)) {
      throw new Error(`Unknown profile "${profile}". Expected one of: ${Object.keys(profiles).join(", ")}.`);
    }
  }

  await buildProject();

  for (const profile of selectedProfiles) {
    for (const target of targets) {
      await buildTarget({
        target,
        profile,
        source: options.source,
        outDir: options.outDir,
        configPath: options.configPath,
        runBuild: false,
        runTools: options.runTools
      });
    }
  }
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

async function main() {
  try {
    await buildAll(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
