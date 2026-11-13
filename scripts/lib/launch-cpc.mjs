import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";
import { capriceConfiguration, capriceLaunchArguments, instrumentCpcTestListing } from "./caprice32.mjs";
import { createCpcDataDisk } from "./cpc-disk.mjs";
import { loadToolConfiguration, resolveTargetConfiguration } from "../target-configurations.mjs";

export async function launchCpc(options) {
  const spawnOptions = capriceSpawnOptions(options.hidden);
  const cwd = options.cwd ?? process.cwd();
  const config = await loadToolConfiguration(cwd, options.configPath);
  const target = resolveTargetConfiguration(config, options.targetConfiguration, { compilerTarget: "cpc", emulatorType: "caprice32" });
  const emulator = target.emulator;
  if (!emulator.path) throw new Error(`No Caprice32 path configured for "${options.targetConfiguration}".`);
  const emulatorPath = resolve(cwd, emulator.path);
  const staging = resolve(cwd, options.outDir, ".caprice32", options.targetConfiguration);
  const pidPath = resolve(staging, "active.pid");
  await mkdir(staging, { recursive: true });
  if (options.restart && process.platform === "win32") {
    await new Promise((resolveStop) => {
      const processStop = spawn("taskkill", ["/F", "/IM", basename(emulatorPath)], { stdio: "ignore", windowsHide: true });
      processStop.on("error", resolveStop);
      processStop.on("exit", resolveStop);
    });
  }
  let previousPid;
  try { previousPid = Number((await readFile(pidPath, "utf8")).trim()); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (Number.isInteger(previousPid) && previousPid > 0) {
    let active = true;
    try { process.kill(previousPid, 0); } catch (error) { if (error.code === "ESRCH") active = false; else if (error.code !== "EPERM") throw error; }
    if (active) throw new Error(`A previous CPC emulator session (${previousPid}) is still running; close it before rebuilding its disk.`);
    await rm(pidPath, { force: true });
  }
  await buildTarget({ ...options, target: "cpc", testPrinterOutput: options.testMode && options.testPrinterOutput, runTools: true });
  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  const basicPath = outputPathFor(cwd, options.outDir, options.profile, "cpc", program.name, ".bas");
  let diskPath = outputPathFor(cwd, options.outDir, options.profile, "cpc", program.name, ".dsk");
  const capture = resolve(cwd, options.outDir, "printer", options.profile, options.targetConfiguration, `${program.name}.txt`);
  await mkdir(dirname(capture), { recursive: true });
  const sourceConfig = emulator.configPath ? resolve(cwd, emulator.configPath) : resolve(dirname(emulatorPath), "cap32.cfg");
  const isolatedConfig = resolve(staging, "cap32.cfg");
  await writeFile(isolatedConfig, capriceConfiguration(await readFile(sourceConfig, "utf8"), emulatorPath, capture));
  if (options.testMode && options.testPrinterOutput) {
    diskPath = resolve(staging, "runner.dsk");
    const listing = instrumentCpcTestListing(await readFile(basicPath, "utf8"));
    await writeFile(diskPath, createCpcDataDisk("MAIN.BAS", listing));
    await rm(capture, { force: true });
  }
  const child = spawn(emulatorPath, capriceLaunchArguments(isolatedConfig, diskPath), spawnOptions);
  await new Promise((resolveStart, rejectStart) => {
    child.once("spawn", resolveStart);
    child.once("error", rejectStart);
  });
  try { await writeFile(pidPath, `${child.pid}\n`, "utf8"); }
  catch (error) { child.kill(); throw error; }
  console.log(`launched ${options.targetConfiguration} with ${diskPath}`);
  if (!options.testMode || !options.testPrinterOutput) {
    child.unref();
    return;
  }
  const failure = new Promise((_, reject) => child.once("error", reject));
  try {
    const result = await Promise.race([waitForCapture(capture, child, options.timeoutMs ?? 180000), failure]);
    console.log(`captured ${capture}\n${result}`);
    const listing = await readFile(basicPath, "utf8");
    const expected = [...listing.matchAll(/"RUNNING [^"\r\n]+\.\.\."/gu)].length;
    const field = (label) => Number(new RegExp(`^${label}:\\s*(\\d+)`, "mu").exec(result)?.[1] ?? NaN);
    if (!/META CONTROL PROGRAM \(M\.C\.P\.\) RUN FINISHED/u.test(result) || expected === 0 ||
        field("TESTS") !== expected || field("PASSED") !== expected || field("FAILED") !== 0 ||
        !Number.isFinite(field("ASSERTIONS")) || field("FAILURES") !== 0 || !Number.isFinite(field("FREE MEMORY"))) {
      throw new Error("CPC test runner did not report a complete passing result.");
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
      child.kill();
      await exited;
    }
    await rm(pidPath, { force: true });
  }
}

export function capriceSpawnOptions(hidden, platform = process.platform) {
  if (hidden && platform !== "win32") {
    throw new Error("The --hidden option is currently available only on Windows; omit it to launch visibly.");
  }
  return { stdio: "ignore", ...(platform === "win32" ? { windowsHide: hidden === true } : {}) };
}

async function waitForCapture(path, child, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let text = "";
    try { text = await readFile(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (text.includes("__MBCPC FLUSH__") && (text.includes("RUN FINISHED") || /ERROR\s+\d+\s+AT/u.test(text))) return text.split("__MBCPC FLUSH__")[0];
    if (child.exitCode !== null) throw new Error(`Caprice32 exited before the test capture completed (exit ${child.exitCode}).`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for CPC test capture: ${path}`);
}

export function parseCpcArgs(argv) {
  const options = { source: "examples/colors.mbas", profile: "release", outDir: "build", configPath: "scripts/tools.local.json", targetConfiguration: "cpc", runBuild: true, testMode: false, testPrinterOutput: false, hidden: false };
  const valued = { "--source": "source", "--build-config": "buildConfigPath", "--project": "projectPath", "--module": "moduleName", "--profile": "profile", "--out-dir": "outDir", "--config": "configPath", "--target-configuration": "targetConfiguration", "--language": "language", "--font": "font", "--test-output-device": "testOutputDevice" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (Object.hasOwn(valued, arg)) {
      if (!argv[index + 1]) throw new Error(`Missing value for ${arg}.`);
      options[valued[arg]] = argv[++index];
    } else if (arg === "--run-tests") options.testMode = true;
    else if (arg === "--printer-output") options.testPrinterOutput = true;
    else if (arg === "--test-screen-output") options.testScreenOutput = true;
    else if (arg === "--skip-build") options.runBuild = false;
    else if (arg === "--hidden") options.hidden = true;
    else if (arg === "--restart") options.restart = true;
    else throw new Error(`Unknown option "${arg}".`);
  }
  if (options.moduleName && (!options.projectPath || !options.testMode)) throw new Error("--module requires --project and --run-tests.");
  if (options.testPrinterOutput && !options.testMode) throw new Error("--printer-output requires --run-tests.");
  if (options.testOutputDevice && !["printer", "text-printer"].includes(options.testOutputDevice)) throw new Error("CPC test output supports printer or text-printer.");
  return options;
}

export async function runLaunchCpcCli() {
  try { await launchCpc(parseCpcArgs(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
