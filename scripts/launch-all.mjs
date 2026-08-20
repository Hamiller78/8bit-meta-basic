#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultProfile = "release";
const defaultToolConfig = "scripts/tools.local.json";

const launchTargets = [
  { target: "spectrum", script: "scripts/launch-spectrum.mjs" },
  { target: "atari800xl", script: "scripts/launch-atari.mjs" },
  { target: "c64", script: "scripts/launch-c64.mjs" }
];

export function configuredLaunchTargets(config) {
  return launchTargets.filter(({ target }) => Boolean(config?.[target]?.emulator?.path));
}

async function launchAll(options) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(resolve(cwd, options.configPath));
  const configured = configuredLaunchTargets(config);

  if (configured.length === 0) {
    throw new Error(`No emulator paths configured. Add emulator.path entries to ${options.configPath}.`);
  }

  const commonArgs = [
    "--source",
    options.source,
    "--profile",
    options.profile,
    "--out-dir",
    options.outDir,
    "--config",
    options.configPath,
    ...(options.restart ? ["--restart"] : [])
  ];

  const launches = configured.map(({ target, script }) => {
    const args = [...commonArgs];
    if (target === "atari800xl" && options.atariArtifact) {
      args.push("--artifact", options.atariArtifact);
    }
    return runLaunch(script, args, cwd);
  });

  const results = await Promise.allSettled(launches);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(`${failures.length} emulator launch${failures.length === 1 ? "" : "es"} failed.`);
  }
}

function runLaunch(script, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: "inherit",
      windowsHide: false
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${script} exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

function parseArgs(argv) {
  const options = {
    source: defaultSource,
    profile: defaultProfile,
    outDir: defaultOutDir,
    configPath: defaultToolConfig,
    atariArtifact: undefined,
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
    if (arg === "--atari-artifact") {
      options.atariArtifact = readValue(argv, index, arg);
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
  return JSON.parse(await readFile(configPath, "utf8"));
}

async function main() {
  try {
    await launchAll(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
