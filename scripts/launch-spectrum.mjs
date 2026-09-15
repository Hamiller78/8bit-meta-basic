#!/usr/bin/env node
import { access, mkdir, readdir, readFile, readlink, realpath, writeFile } from "node:fs/promises";
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
    language: options.language,
    font: options.font,
    testMode: options.testMode,
    testPrinterOutput: options.testPrinterOutput,
    testOutputDevice,
    moduleName: options.moduleName,
    outDir: options.outDir,
    configPath: options.configPath,
    runBuild: options.runBuild,
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
    await terminateExistingSpectrumEmulator(emulatorPath, emulator);
  }

  const replacements = {
    artifact,
    source: program.inputPath,
    sourceName: program.name,
    profile: options.profile,
    target: "spectrum",
    nullDevice: process.platform === "win32" ? "NUL" : "/dev/null",
    printerOutput: deviceOutputPath(cwd, emulator, options, program.name, "spectrum", "printer"),
    rs232Output: deviceOutputPath(cwd, emulator, options, program.name, "spectrum", "rs232")
  };
  if (options.testPrinterOutput) {
    await prepareDeviceOutput(testOutputDevice === "rs232" ? replacements.rs232Output : replacements.printerOutput);
  }
  const deviceArgs = testOutputDevice === "rs232" ? emulator.rs232Args ?? [] : emulator.printerArgs ?? [];
  const argsTemplate = spectrumEmulatorArgsTemplate(emulator, {
    testMode: options.testMode,
    fast: options.fast,
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
  const testArgs = options.testMode || options.fast ? emulator.testArgs ?? ["--speed", "1000"] : [];
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
    runBuild: true,
    restart: false,
    fast: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--language" || arg === "--font") {
      const value = readValue(argv, index, arg);
      options[arg === "--language" ? "language" : "font"] = value;
      index += 1;
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
    if (arg === "--skip-build") {
      options.runBuild = false;
      continue;
    }
    if (arg === "--fast") {
      options.fast = true;
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

export function spectrumEmulatorProcessNames(emulatorPath, emulator = {}) {
  const configuredNames = Array.isArray(emulator.processNames) ? emulator.processNames : [];
  const displayName = typeof emulator.name === "string" && /^[A-Za-z0-9._+-]+$/.test(emulator.name) ? emulator.name.toLowerCase() : undefined;
  return [...new Set([basename(emulatorPath), displayName, ...configuredNames].filter((name) => typeof name === "string" && name.length > 0))];
}

export async function linuxProcessIdsForExecutable(executablePath, procRoot = "/proc") {
  const targetPath = await realpath(executablePath);
  const entries = await readdir(procRoot, { withFileTypes: true });
  const matches = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(async (entry) => {
        try {
          const linkedPath = (await readlink(join(procRoot, entry.name, "exe"))).replace(/ \(deleted\)$/, "");
          return linkedPath === targetPath ? Number(entry.name) : undefined;
        } catch {
          return undefined;
        }
      })
  );
  return matches.filter((pid) => pid !== undefined).sort((left, right) => left - right);
}

export async function terminateExistingSpectrumEmulator(emulatorPath, emulator = {}) {
  const processNames = spectrumEmulatorProcessNames(emulatorPath, emulator);
  if (process.platform === "win32") {
    for (const processName of processNames) {
      await runBestEffort("taskkill", ["/F", "/IM", processName]);
    }
    return;
  }

  if (process.platform === "linux") {
    const matchingPids = (await linuxProcessIdsForExecutable(emulatorPath)).filter((pid) => pid !== process.pid);
    await terminateProcessIds(matchingPids);
  }

  for (const processName of processNames) {
    await runBestEffort("pkill", ["-x", processName]);
  }
}

async function terminateProcessIds(pids) {
  for (const pid of pids) {
    signalProcess(pid, "SIGTERM");
  }

  let survivors = await waitForProcessExit(pids, 1000);
  for (const pid of survivors) {
    signalProcess(pid, "SIGKILL");
  }
  survivors = await waitForProcessExit(survivors, 1000);
  if (survivors.length > 0) {
    throw new Error(`Could not terminate existing Spectrum emulator process${survivors.length === 1 ? "" : "es"}: ${survivors.join(", ")}.`);
  }
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error) || !Reflect.has(error, "code") || error.code !== "ESRCH") {
      throw error;
    }
  }
}

async function waitForProcessExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let survivors = pids.filter(isProcessRunning);
  while (survivors.length > 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    survivors = survivors.filter(isProcessRunning);
  }
  return survivors;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && Reflect.has(error, "code") && error.code === "EPERM";
  }
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
