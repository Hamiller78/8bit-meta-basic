#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { buildTarget } from "./build-target.mjs";

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultProfile = "release";
const defaultToolConfig = "scripts/tools.local.json";
const artifactExtensions = {
  atr: ".atr",
  "tokenized-bas": ".tokenized.bas",
  lst: ".lst",
  "disk-directory": ".atr-files"
};

async function launchAtari(options) {
  const cwd = options.cwd ?? process.cwd();

  await buildTarget({
    target: "atari800xl",
    profile: options.profile,
    source: options.source,
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

  const config = await loadConfig(resolve(cwd, options.configPath));
  const emulator = config?.atari800xl?.emulator;
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

  const replacements = {
    ...artifacts,
    artifact,
    source: resolve(cwd, options.source),
    sourceName: basename(options.source, extname(options.source)),
    profile: options.profile,
    target: "atari800xl"
  };
  const argsTemplate = emulator.artifactArgs?.[options.artifact] ?? emulator.args ?? ["{artifact}"];
  const args = argsTemplate.map((arg) => replacePlaceholders(arg, replacements));

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

function buildArtifacts(cwd, options) {
  return {
    atr: outputPathFor(cwd, options.outDir, options.profile, options.source, ".atr"),
    "tokenized-bas": outputPathFor(cwd, options.outDir, options.profile, options.source, ".tokenized.bas"),
    lst: outputPathFor(cwd, options.outDir, options.profile, options.source, ".lst"),
    "disk-directory": outputPathFor(cwd, options.outDir, options.profile, options.source, ".atr-files")
  };
}

function outputPathFor(cwd, outDir, profile, source, extension) {
  const name = basename(source, extname(source));
  return resolve(cwd, outDir, profile, "atari800xl", `${name}${extension}`);
}

function replacePlaceholders(value, replacements) {
  return value.replaceAll(/\{([A-Za-z-]+)\}/g, (match, key) => replacements[key] ?? match);
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
