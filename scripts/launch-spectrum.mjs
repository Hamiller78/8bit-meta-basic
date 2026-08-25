#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";
import { parseDeviceKind } from "./device-options.mjs";

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultProfile = "release";
const defaultToolConfig = "scripts/tools.local.json";
const defaultTestOutputDevice = "text-printer";

async function launchSpectrum(options) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(resolve(cwd, options.configPath));
  const emulator = config?.spectrum?.emulator;
  const testOutputDevice = options.testOutputDevice ?? configuredTestOutputDevice(emulator, defaultTestOutputDevice);

  await buildTarget({
    target: "spectrum",
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

  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  const artifact = outputPathFor(cwd, options.outDir, options.profile, "spectrum", program.name, ".tap");
  if (!(await exists(artifact))) {
    throw new Error(`Spectrum launch artifact not found: ${artifact}. Check that bas2tap is configured and produced a .tap file.`);
  }

  if (!emulator?.path) {
    throw new Error(`No Spectrum emulator path configured. Add spectrum.emulator.path to ${options.configPath}.`);
  }

  const emulatorPath = resolve(cwd, emulator.path);
  if (!(await exists(emulatorPath))) {
    throw new Error(`Spectrum emulator not found at ${emulator.path}.`);
  }

  if (options.restart) {
    await terminateExistingEmulator(emulatorPath);
  }

  const replacements = {
    artifact,
    source: program.inputPath,
    sourceName: program.name,
    profile: options.profile,
    target: "spectrum",
    printerOutput: deviceOutputPath(cwd, emulator, options, program.name, "spectrum", "printer"),
    rs232Output: deviceOutputPath(cwd, emulator, options, program.name, "spectrum", "rs232")
  };
  if (options.testPrinterOutput) {
    await prepareDeviceOutput(testOutputDevice === "rs232" ? replacements.rs232Output : replacements.printerOutput);
  }
  const deviceArgs = testOutputDevice === "rs232" ? emulator.rs232Args ?? [] : emulator.printerArgs ?? [];
  const argsTemplate = spectrumEmulatorArgsTemplate(emulator, {
    testMode: options.testMode,
    testPrinterOutput: options.testPrinterOutput,
    deviceArgs
  });
  const args = argsTemplate.map((arg) => replacePlaceholders(arg, replacements));

  const child = spawn(emulatorPath, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();

  console.log(`launched ${emulator.name ?? "Spectrum emulator"} with ${relativeToCwd(cwd, artifact)}`);
}

export function spectrumEmulatorArgsTemplate(emulator = {}, options = {}) {
  const baseArgs = emulator.args ?? ["-tape", "{artifact}", "-auto-play"];
  const testArgs = options.testMode ? emulator.testArgs ?? ["--speed", "500"] : [];
  const deviceArgs = options.testPrinterOutput ? options.deviceArgs ?? [] : [];
  return [...baseArgs, ...testArgs, ...deviceArgs];
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

function replacePlaceholders(value, replacements) {
  return value.replaceAll(/\{([A-Za-z][A-Za-z0-9-]*)\}/g, (match, key) => replacements[key] ?? match);
}

function deviceOutputPath(cwd, emulator, options, sourceName, target, device) {
  const template = device === "rs232"
    ? emulator.rs232OutputPath ?? "build/rs232/{profile}/{target}/{sourceName}.txt"
    : emulator.printerOutputPath ?? "build/printer/{profile}/{target}/{sourceName}.txt";
  return resolve(cwd, replacePlaceholders(template, { profile: options.profile, target, sourceName }));
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
    await launchSpectrum(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
