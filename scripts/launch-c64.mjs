#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";
import { parseDeviceKind } from "./device-options.mjs";

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultProfile = "release";
const defaultToolConfig = "scripts/tools.local.json";

async function launchC64(options) {
  const cwd = options.cwd ?? process.cwd();

  await buildTarget({
    target: "c64",
    profile: options.profile,
    source: options.source,
    buildConfigPath: options.buildConfigPath,
    projectPath: options.projectPath,
    testMode: options.testMode,
    testPrinterOutput: options.testPrinterOutput,
    testOutputDevice: options.testOutputDevice,
    moduleName: options.moduleName,
    outDir: options.outDir,
    configPath: options.configPath,
    runBuild: true,
    runTools: true
  });

  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  const artifact = outputPathFor(cwd, options.outDir, options.profile, "c64", program.name, ".prg");
  if (!(await exists(artifact))) {
    throw new Error(`C64 launch artifact not found: ${artifact}. Check that petcat is configured and produced a .prg file.`);
  }

  const config = await loadConfig(resolve(cwd, options.configPath));
  const emulator = config?.c64?.emulator;
  if (!emulator?.path) {
    throw new Error(`No C64 emulator path configured. Add c64.emulator.path to ${options.configPath}.`);
  }

  const emulatorPath = resolve(cwd, emulator.path);
  if (!(await exists(emulatorPath))) {
    throw new Error(`C64 emulator not found at ${emulator.path}.`);
  }

  if (options.restart) {
    await terminateExistingEmulator(emulatorPath);
  }

  const replacements = {
    artifact,
    source: program.inputPath,
    sourceName: program.name,
    profile: options.profile,
    target: "c64",
    printerOutput: deviceOutputPath(cwd, emulator, options, program.name, "c64", "printer"),
    rs232Output: deviceOutputPath(cwd, emulator, options, program.name, "c64", "rs232"),
    rs232Endpoint: undefined
  };
  if (options.testPrinterOutput) {
    await prepareDeviceOutput(options.testOutputDevice === "rs232" ? replacements.rs232Output : replacements.printerOutput);
  }
  if (options.testPrinterOutput && options.testOutputDevice === "rs232") {
    replacements.rs232Endpoint = await startRs232Capture(cwd, replacements.rs232Output, options, emulator, program.name);
  }
  const deviceArgs = options.testOutputDevice === "rs232" ? emulator.rs232Args ?? [] : emulator.printerArgs ?? [];
  const argsTemplate = [...(emulator.args ?? ["-autostart", "{artifact}"]), ...(options.testPrinterOutput ? deviceArgs : [])];
  const args = argsTemplate.map((arg) => replacePlaceholders(arg, replacements));

  const child = spawn(emulatorPath, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();

  console.log(`launched ${emulator.name ?? "c64 emulator"} with ${relativeToCwd(cwd, artifact)}`);
}

function parseArgs(argv) {
  const options = {
    source: defaultSource,
    buildConfigPath: undefined,
    projectPath: undefined,
    testMode: false,
    testPrinterOutput: false,
    testOutputDevice: "printer",
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

async function startRs232Capture(cwd, outputPath, options, emulator, sourceName) {
  const scriptPath = resolve(cwd, "scripts/rs232-capture.mjs");
  const readyPath = resolve(
    cwd,
    options.outDir,
    ".rs232-capture",
    `${options.profile}-c64-${safeName(sourceName)}-${Date.now()}.json`
  );
  await mkdir(dirname(readyPath), { recursive: true });

  const child = spawn(process.execPath, [
    scriptPath,
    "--output",
    outputPath,
    "--port",
    String(emulator.rs232CapturePort ?? 0),
    "--ready",
    readyPath
  ], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  const ready = await waitForCaptureReady(readyPath);
  return `${ready.host}:${ready.port}`;
}

async function waitForCaptureReady(readyPath) {
  const deadline = Date.now() + 3000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(readyPath, "utf8"));
    } catch (error) {
      lastError = error;
      await sleep(50);
    }
  }
  throw new Error(`RS232 capture endpoint did not start. ${lastError instanceof Error ? lastError.message : ""}`.trim());
}

function safeName(value) {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "");
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
    await launchC64(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
