#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProject, buildTarget, profiles, targets } from "./build-target.mjs";
import { parseDeviceKind } from "./device-options.mjs";

const defaultSourceDir = "examples";
const defaultOutDir = "build";
const defaultToolConfig = "scripts/tools.local.json";

export async function findMbasSources(sourceDir, { cwd = process.cwd() } = {}) {
  const directory = resolve(cwd, sourceDir);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mbas"))
    .map((entry) => `${sourceDir.replaceAll("\\", "/").replace(/\/$/, "")}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

export async function buildDirectory(options) {
  const cwd = options.cwd ?? process.cwd();
  const selectedProfiles = options.allProfiles ? Object.keys(profiles) : [options.profile ?? "debug"];
  const selectedTargets = options.targets?.length ? options.targets : targets;
  const sourceDir = options.sourceDir ?? defaultSourceDir;
  const sources = await findMbasSources(sourceDir, { cwd });

  if (sources.length === 0) {
    throw new Error(`No .mbas files found in ${sourceDir}.`);
  }

  for (const profile of selectedProfiles) {
    if (!Object.hasOwn(profiles, profile)) {
      throw new Error(`Unknown profile "${profile}". Expected one of: ${Object.keys(profiles).join(", ")}.`);
    }
  }
  for (const target of selectedTargets) {
    if (!targets.includes(target)) {
      throw new Error(`Unknown target "${target}". Expected one of: ${targets.join(", ")}.`);
    }
  }

  await buildProject({ cwd });

  for (const source of sources) {
    for (const profile of selectedProfiles) {
      for (const target of selectedTargets) {
        await buildTarget({
          cwd,
          target,
          profile,
          source,
          testMode: options.testMode === true,
          testPrinterOutput: options.testPrinterOutput === true,
          testOutputDevice: options.testOutputDevice,
          outDir: options.outDir ?? defaultOutDir,
          configPath: options.configPath ?? defaultToolConfig,
          runBuild: false,
          runTools: options.runTools ?? true
        });
      }
    }
  }

  return sources;
}

function parseArgs(argv) {
  const options = {
    sourceDir: defaultSourceDir,
    profile: "debug",
    allProfiles: false,
    targets: [],
    outDir: defaultOutDir,
    configPath: defaultToolConfig,
    runTools: true,
    testMode: false,
    testPrinterOutput: false,
    testOutputDevice: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--source-dir" || arg === "--dir") {
      options.sourceDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--profile") {
      options.profile = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--all-profiles") {
      options.allProfiles = true;
      continue;
    }
    if (arg === "--target") {
      options.targets.push(readValue(argv, index, arg));
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
    throw new Error(`Unknown option "${arg}".`);
  }

  if (options.testPrinterOutput && !options.testMode) {
    throw new Error("--printer-output can only be used with --run-tests.");
  }

  return options;
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
    await buildDirectory(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
