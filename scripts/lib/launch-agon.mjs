import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";
import { parseDeviceKind } from "../device-options.mjs";
import { loadToolConfiguration, resolveTargetConfiguration } from "../target-configurations.mjs";

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultProfile = "release";
const defaultToolConfig = "scripts/tools.local.json";

export async function launchAgon(options) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadToolConfiguration(cwd, options.configPath);
  const targetConfiguration = resolveTargetConfiguration(config, options.targetConfiguration, {
    compilerTarget: "agon",
    emulatorType: "fab-agon"
  });
  const emulator = targetConfiguration.emulator;

  await buildTarget({
    target: "agon",
    profile: options.profile,
    source: options.source,
    buildConfigPath: options.buildConfigPath,
    projectPath: options.projectPath,
    language: options.language,
    font: options.font,
    testMode: options.testMode,
    testScreenOutput: options.testScreenOutput,
    testPrinterOutput: options.testMode ? options.testPrinterOutput : false,
    testOutputDevice: options.testOutputDevice ?? "shared-drive",
    moduleName: options.moduleName,
    outDir: options.outDir,
    configPath: options.configPath,
    runBuild: options.runBuild,
    runTools: true
  });

  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  const artifact = outputPathFor(cwd, options.outDir, options.profile, "agon", program.name, ".bas");
  if (!(await exists(artifact))) throw new Error(`Agon BASIC artifact not found: ${artifact}.`);
  if (!emulator?.path) throw new Error(`No emulator path configured for target configuration "${options.targetConfiguration}" in ${options.configPath}.`);
  if (!emulator?.sdcardPath) throw new Error(`No emulator sdcardPath configured for target configuration "${options.targetConfiguration}" in ${options.configPath}.`);

  const emulatorPath = resolve(cwd, emulator.path);
  const sdcardPath = resolve(cwd, emulator.sdcardPath);
  if (!(await exists(emulatorPath))) throw new Error(`Fab Agon Emulator not found at ${emulator.path}.`);
  if (!(await exists(sdcardPath))) throw new Error(`Agon virtual SD card directory not found at ${emulator.sdcardPath}.`);

  if (options.restart) await terminateExistingEmulator(emulatorPath);
  await prepareSdCard(artifact, sdcardPath, emulator);

  const args = (emulator.args ?? ["--sdcard", "{sdcard}"]).map((argument) =>
    argument.replaceAll("{sdcard}", sdcardPath).replaceAll("{artifact}", artifact)
  );
  const child = spawn(emulatorPath, args, { cwd: emulator.workingDirectory ? resolve(cwd, emulator.workingDirectory) : cwd, detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  console.log(`launched target configuration "${options.targetConfiguration}" (${targetConfiguration.computer?.model ?? "Agon Light"}) in ${emulator.name ?? "Fab Agon Emulator"} with ${relativeToCwd(cwd, artifact)}`);
}

async function prepareSdCard(artifact, sdcardPath, emulator) {
  await mkdir(sdcardPath, { recursive: true });
  const cardProgramName = emulator.cardProgramName ?? "metabasic.bas";
  const source = await readFile(artifact, "utf8");
  const crlfSource = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "\r\n");
  await writeFile(resolve(sdcardPath, cardProgramName), crlfSource, "utf8");
  const basicBinary = emulator.basicBinary ?? "bin/bbcbasic24.bin";
  const autoexec = `LOAD ${basicBinary}\r\nRUN . /${cardProgramName}\r\n`;
  await writeFile(resolve(sdcardPath, "autoexec.txt"), autoexec, "ascii");
}

async function terminateExistingEmulator(emulatorPath) {
  if (process.platform !== "win32") return;
  await new Promise((resolveRun) => {
    const child = spawn("taskkill", ["/F", "/IM", basename(emulatorPath)], { stdio: "ignore" });
    child.on("error", () => resolveRun());
    child.on("exit", () => resolveRun());
  });
}

function parseArgs(argv) {
  const options = {
    source: defaultSource,
    buildConfigPath: undefined,
    projectPath: undefined,
    testMode: false,
    testScreenOutput: false,
    testPrinterOutput: false,
    testOutputDevice: undefined,
    moduleName: undefined,
    profile: defaultProfile,
    outDir: defaultOutDir,
    configPath: defaultToolConfig,
    targetConfiguration: "agon",
    runBuild: true,
    restart: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--language", "--font", "--source", "--build-config", "--project", "--module", "--profile", "--out-dir", "--config", "--target-configuration"].includes(arg)) {
      const value = readValue(argv, index, arg);
      const key = {
        "--language": "language", "--font": "font", "--source": "source", "--build-config": "buildConfigPath",
        "--project": "projectPath", "--module": "moduleName", "--profile": "profile", "--out-dir": "outDir",
        "--config": "configPath", "--target-configuration": "targetConfiguration"
      }[arg];
      options[key] = value;
      index += 1;
      continue;
    }
    if (arg === "--test-output-device") {
      options.testOutputDevice = parseDeviceKind(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--run-tests") options.testMode = true;
    else if (arg === "--test-screen-output") options.testScreenOutput = true;
    else if (arg === "--printer-output") options.testPrinterOutput = true;
    else if (arg === "--skip-build") options.runBuild = false;
    else if (arg === "--restart") options.restart = true;
    else if (arg === "--fast") { /* The eZ80 is already fast; accepted for launch-all parity. */ }
    else throw new Error(`Unknown option "${arg}".`);
  }
  if (options.moduleName && (!options.projectPath || !options.testMode)) throw new Error("--module can only be used with --project and --run-tests.");
  if (options.testPrinterOutput && !options.testMode) throw new Error("--printer-output can only be used with --run-tests.");
  if (options.testScreenOutput && !options.testMode) throw new Error("--test-screen-output can only be used with --run-tests.");
  return options;
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value) throw new Error(`Missing value for ${option}.`);
  return value;
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

function relativeToCwd(cwd, path) {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}

export async function runLaunchAgonCli() {
  try {
    await launchAgon(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
