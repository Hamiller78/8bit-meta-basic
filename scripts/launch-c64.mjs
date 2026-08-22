#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";

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
    target: "c64"
  };
  const args = (emulator.args ?? ["-autostart", "{artifact}"]).map((arg) => replacePlaceholders(arg, replacements));

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
  return value.replaceAll(/\{([A-Za-z]+)\}/g, (match, key) => replacements[key] ?? match);
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
