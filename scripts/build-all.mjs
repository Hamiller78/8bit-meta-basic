#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProject, buildTarget, profiles, targets } from "./build-target.mjs";
import { parseDeviceKind } from "./device-options.mjs";

function parseArgs(argv) {
  const options = {
    profile: "debug",
    allProfiles: false,
    source: "examples/colors.mbas",
    buildConfigPath: undefined,
    projectPath: undefined,
    testMode: false,
    testPrinterOutput: false,
    testOutputDevice: undefined,
    moduleName: undefined,
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
    if (arg === "--build-config") {
      options.buildConfigPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--project") {
      options.projectPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--run-tests") {
      options.testMode = true;
      continue;
    }
    if (arg === "--printer-output") {
      options.testPrinterOutput = true;
      continue;
    }
    if (arg === "--test-output-device") {
      options.testOutputDevice = parseDeviceKind(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--module") {
      options.moduleName = readValue(argv, index, arg);
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
  const selectedInputs = [options.source !== "examples/colors.mbas", Boolean(options.buildConfigPath), Boolean(options.projectPath)].filter(Boolean).length;
  if (selectedInputs > 1) {
    throw new Error("Specify only one of --source, --build-config, or --project.");
  }
  if (options.moduleName && (!options.projectPath || !options.testMode)) {
    throw new Error("--module can only be used with --project and --run-tests.");
  }
  if (options.testPrinterOutput && !options.testMode) {
    throw new Error("--printer-output can only be used with --run-tests.");
  }

  await buildProject();

  for (const profile of selectedProfiles) {
    for (const target of targets) {
      await buildTarget({
        target,
        profile,
        source: options.source,
        buildConfigPath: options.buildConfigPath,
        projectPath: options.projectPath,
        testMode: options.testMode,
        testPrinterOutput: options.testPrinterOutput,
        testOutputDevice: options.testOutputDevice,
        moduleName: options.moduleName,
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
