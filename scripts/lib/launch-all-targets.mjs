import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseDeviceKind } from "../device-options.mjs";
import { launcherScriptFor, namedTargetConfigurations } from "../target-configurations.mjs";

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultProfile = "release";
const defaultToolConfig = "scripts/tools.local.json";

export function configuredLaunchTargets(config, options = {}) {
  const selected = options.targetConfigurations ?? [];
  return Object.entries(namedTargetConfigurations(config))
    .filter(([name, targetConfiguration]) => {
      return targetConfiguration?.emulator?.path && (selected.length === 0 || selected.includes(name));
    })
    .map(([name, targetConfiguration]) => ({
      name,
      target: targetConfiguration.compilerTarget,
      emulatorPath: targetConfiguration.emulator.path,
      script: launcherScriptFor(targetConfiguration)
    }));
}

async function launchAll(options) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(resolve(cwd, options.configPath));
  const configured = configuredLaunchTargets(config, { targetConfigurations: options.targetConfigurations });

  if (configured.length === 0) {
    throw new Error(`No emulator paths configured. Add emulator.path entries to ${options.configPath}.`);
  }

  const commonArgs = [
    ...(options.language ? ["--language", options.language] : []),
    ...(options.font ? ["--font", options.font] : []),
    ...(options.projectPath ? ["--project", options.projectPath] : options.buildConfigPath ? ["--build-config", options.buildConfigPath] : ["--source", options.source]),
    "--profile",
    options.profile,
    "--out-dir",
    options.outDir,
    "--config",
    options.configPath,
    ...(options.testMode ? ["--run-tests"] : []),
    ...(options.testPrinterOutput ? ["--printer-output"] : []),
    ...(options.testPrinterOutput && options.testOutputDevice ? ["--test-output-device", options.testOutputDevice] : []),
    ...(options.moduleName ? ["--module", options.moduleName] : []),
    ...(options.runBuild ? [] : ["--skip-build"])
  ];

  const restartedEmulators = new Set();
  for (const { name, target, emulatorPath, script } of configured) {
    const args = ["--target-configuration", name, ...commonArgs];
    if (options.restart && !restartedEmulators.has(emulatorPath)) {
      args.push("--restart");
      restartedEmulators.add(emulatorPath);
    }
    if (target === "atari800xl" && options.atariArtifact) {
      args.push("--artifact", options.atariArtifact);
    }
    await runLaunch(script, args, cwd);
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
    buildConfigPath: undefined,
    projectPath: undefined,
    testMode: false,
    testPrinterOutput: false,
    testOutputDevice: undefined,
    moduleName: undefined,
    profile: defaultProfile,
    outDir: defaultOutDir,
    configPath: defaultToolConfig,
    atariArtifact: undefined,
    targetConfigurations: [],
    runBuild: true,
    restart: false
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
    if (arg === "--atari-artifact") {
      options.atariArtifact = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--target-configuration") {
      options.targetConfigurations.push(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--skip-build") {
      options.runBuild = false;
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

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runLaunchAllTargetsCli() {
  try {
    await launchAll(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

