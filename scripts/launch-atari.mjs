#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";
import { parseDeviceKind } from "./device-options.mjs";

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultProfile = "release";
const defaultToolConfig = "scripts/tools.local.json";
const defaultTestOutputDevice = "shared-drive";
const artifactExtensions = {
  atr: ".atr",
  "tokenized-bas": ".tokenized.bas",
  lst: ".lst",
  "disk-directory": ".atr-files"
};

async function launchAtari(options) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(resolve(cwd, options.configPath));
  const emulator = config?.atari800xl?.emulator;
  const testOutputDevice = options.testOutputDevice ?? configuredTestOutputDevice(emulator, defaultTestOutputDevice);

  await buildTarget({
    target: "atari800xl",
    profile: options.profile,
    source: options.source,
    buildConfigPath: options.buildConfigPath,
    projectPath: options.projectPath,
    testMode: options.testMode,
    testPrinterOutput: options.testPrinterOutput,
    testOutputDevice,
    moduleName: options.moduleName,
    outDir: options.outDir,
    configPath: options.configPath,
    runBuild: true,
    runTools: true
  });

  const artifacts = buildArtifacts(cwd, options);
  const artifact = artifacts[options.artifact];
  if (!artifact) {
    throw new Error(`Unknown Atari launch artifact "${options.artifact}". Expected one of: ${Object.keys(artifactExtensions).join(", ")}.`);
  }
  if (!(await exists(artifact))) {
    throw new Error(`Atari launch artifact not found: ${artifact}. Check that the configured tools produced it.`);
  }

  if (!emulator?.path) {
    throw new Error(`No Atari emulator path configured. Add atari800xl.emulator.path to ${options.configPath}.`);
  }

  const emulatorPath = resolve(cwd, emulator.path);
  if (!(await exists(emulatorPath))) {
    throw new Error(`Atari emulator not found at ${emulator.path}.`);
  }

  if (options.restart) {
    await terminateExistingEmulator(emulatorPath);
  }

  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  const replacements = {
    ...artifacts,
    artifact,
    source: program.inputPath,
    sourceName: program.name,
    profile: options.profile,
    target: "atari800xl",
    printerOutput: deviceOutputPath(cwd, emulator, options, program.name, "atari800xl", "printer"),
    rs232Output: deviceOutputPath(cwd, emulator, options, program.name, "atari800xl", "rs232"),
    sharedDrive: sharedDrivePath(cwd, emulator, options, program.name, "atari800xl"),
    sharedDriveOutput: sharedDriveOutputPath(cwd, emulator, options, program.name, "atari800xl")
  };
  if (options.testPrinterOutput) {
    await prepareDeviceOutput(deviceOutputForKind(testOutputDevice, replacements));
  }
  const argsTemplate = emulator.artifactArgs?.[options.artifact] ?? emulator.args ?? ["{artifact}"];
  const deviceArgs = deviceArgsForKind(testOutputDevice, emulator);
  const args = [...argsTemplate, ...(options.testPrinterOutput ? deviceArgs : [])].map((arg) => replacePlaceholders(arg, replacements));

  const child = spawn(emulatorPath, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();

  console.log(`launched ${emulator.name ?? "Atari emulator"} with ${relativeToCwd(cwd, artifact)}`);
}

function parseArgs(argv) {
  const options = {
    source: defaultSource,
    buildConfigPath: undefined,
    projectPath: undefined,
    testMode: false,
    testPrinterOutput: false,
    testOutputDevice: undefined,
    moduleName: undefined,
    profile: defaultProfile,
    outDir: defaultOutDir,
    configPath: defaultToolConfig,
    artifact: "tokenized-bas",
    restart: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

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
    if (arg === "--profile") {
      options.profile = readValue(argv, index, arg);
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
    if (arg === "--artifact") {
      options.artifact = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--restart" || arg === "--kill-existing") {
      options.restart = true;
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  const selectedInputs = [options.source !== defaultSource, Boolean(options.buildConfigPath), Boolean(options.projectPath)].filter(Boolean).length;
  if (selectedInputs > 1) {
    throw new Error("Specify only one of --source, --build-config, or --project.");
  }
  if (options.moduleName && (!options.projectPath || !options.testMode)) {
    throw new Error("--module can only be used with --project and --run-tests.");
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

function configuredTestOutputDevice(emulator, fallback) {
  return emulator?.testOutputDevice ? parseDeviceKind(emulator.testOutputDevice, "emulator.testOutputDevice") : fallback;
}

async function loadConfig(configPath) {
  if (!(await exists(configPath))) {
    return undefined;
  }

  return JSON.parse(await readFile(configPath, "utf8"));
}

function buildArtifacts(cwd, options) {
  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  return {
    atr: outputPathFor(cwd, options.outDir, options.profile, "atari800xl", program.name, ".atr"),
    "tokenized-bas": outputPathFor(cwd, options.outDir, options.profile, "atari800xl", program.name, ".tokenized.bas"),
    lst: outputPathFor(cwd, options.outDir, options.profile, "atari800xl", program.name, ".lst"),
    "disk-directory": outputPathFor(cwd, options.outDir, options.profile, "atari800xl", program.name, ".atr-files")
  };
}

function replacePlaceholders(value, replacements) {
  return value.replaceAll(/\{([A-Za-z][A-Za-z0-9-]*)\}/g, (match, key) => replacements[key] ?? match);
}

function deviceOutputPath(cwd, emulator, options, sourceName, target, device) {
  const template = device === "rs232"
    ? emulator.rs232OutputPath ?? "build/rs232/{profile}/{target}/{sourceName}.txt"
    : emulator.printerOutputPath ?? "build/printer/{profile}/{target}/{sourceName}.txt";
  return resolve(cwd, replacePlaceholders(template, { profile: options.profile, target, sourceName }));
}

function sharedDrivePath(cwd, emulator, options, sourceName, target) {
  const template = emulator.sharedDrivePath ?? "build/altirra_drive";
  return resolve(cwd, replacePlaceholders(template, { profile: options.profile, target, sourceName }));
}

function sharedDriveOutputPath(cwd, emulator, options, sourceName, target) {
  const configured = emulator.sharedDriveOutputPath;
  if (configured) {
    return resolve(cwd, replacePlaceholders(configured, { profile: options.profile, target, sourceName }));
  }

  return join(sharedDrivePath(cwd, emulator, options, sourceName, target), "MCP.TXT");
}

function deviceOutputForKind(device, replacements) {
  if (device === "rs232") {
    return replacements.rs232Output;
  }
  if (device === "shared-drive") {
    return replacements.sharedDriveOutput;
  }
  return replacements.printerOutput;
}

function deviceArgsForKind(device, emulator) {
  if (device === "rs232") {
    return emulator.rs232Args ?? [];
  }
  if (device === "shared-drive") {
    return emulator.sharedDriveArgs ?? [];
  }
  return emulator.printerArgs ?? [];
}

async function prepareDeviceOutput(path) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
}

async function terminateExistingEmulator(emulatorPath) {
  const executableName = basename(emulatorPath);
  if (process.platform === "win32") {
    await runBestEffort("taskkill", ["/F", "/IM", executableName]);
    return;
  }

  await runBestEffort("pkill", ["-x", executableName]);
}

function runBestEffort(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolveRun());
    child.on("exit", () => resolveRun());
  });
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function relativeToCwd(cwd, path) {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}

async function main() {
  try {
    await launchAtari(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
