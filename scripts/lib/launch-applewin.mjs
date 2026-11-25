import { access, chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";
import { loadToolConfiguration, resolveTargetConfiguration } from "../target-configurations.mjs";

export function parseAppleWinArgs(argv) {
  const options = { source: "examples/array-demo.mbas", profile: "release", outDir: "build", configPath: "scripts/tools.local.json", targetConfiguration: "apple2", runBuild: true };
  const values = { "--source": "source", "--project": "projectPath", "--build-config": "buildConfigPath", "--profile": "profile", "--out-dir": "outDir", "--config": "configPath", "--target-configuration": "targetConfiguration", "--language": "language", "--font": "font", "--file-storage": "fileStorage", "--module": "moduleName", "--test-output-device": "testOutputDevice", "--timeout": "timeout" };
  let explicitSource = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (Object.hasOwn(values, arg)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[values[arg]] = argv[++index];
      if (arg === "--source") explicitSource = true;
    } else if (arg === "--skip-build") options.runBuild = false;
    else if (arg === "--hidden") options.hidden = true;
    else if (arg === "--restart") options.restart = true;
    else if (arg === "--run-tests") options.testMode = true;
    else if (arg === "--test-screen-output") options.testScreenOutput = true;
    else if (arg === "--printer-output") options.testPrinterOutput = true;
    else throw new Error(`Unsupported AppleWin launch option "${arg}".`);
  }
  if ([explicitSource, Boolean(options.projectPath), Boolean(options.buildConfigPath)].filter(Boolean).length > 1) throw new Error("Select only one of --source, --build-config, or --project.");
  if (options.moduleName && (!options.projectPath || !options.testMode)) throw new Error("--module requires --project and --run-tests.");
  if ((options.testPrinterOutput || options.testScreenOutput || options.testOutputDevice) && !options.testMode) throw new Error("Test output options require --run-tests.");
  if (options.testOutputDevice && !["printer", "text-printer"].includes(options.testOutputDevice)) throw new Error("AppleWin capture supports printer or text-printer only.");
  if (options.timeout !== undefined && (!Number.isFinite(Number(options.timeout)) || Number(options.timeout) <= 0)) throw new Error("--timeout must be a positive number of seconds.");
  return options;
}

export function verifyAppleWinCapture(captured, expected) {
  const field = (name) => Number(new RegExp(`^${name}:\\s*(\\d+)`, "imu").exec(captured)?.[1] ?? NaN);
  return Number.isInteger(expected) && expected > 0 &&
    captured.replace(/\s+/gu, "").toUpperCase().includes("METACONTROLPROGRAM(M.C.P.)RUNFINISHED") &&
    field("TESTS") === expected && field("PASSED") === expected && field("FAILED") === 0 &&
    Number.isFinite(field("ASSERTIONS")) && field("FAILURES") === 0 && Number.isFinite(field("FREE MEMORY"));
}

export async function launchAppleWin(options) {
  if (process.platform !== "win32") throw new Error("AppleWin launch currently supports Windows only.");
  const cwd = options.cwd ?? process.cwd();
  const configuration = await loadToolConfiguration(cwd, options.configPath);
  const target = resolveTargetConfiguration(configuration, options.targetConfiguration, { compilerTarget: "apple2", emulatorType: "applewin" });
  const emulator = target.emulator;
  for (const field of ["path", "dosDisk", "appleCommander", "acceptedConfig"]) if (!emulator[field]) throw new Error(`AppleWin ${field} is not configured for "${options.targetConfiguration}".`);
  const executable = resolve(cwd, emulator.path), template = resolve(cwd, emulator.dosDisk), jar = resolve(cwd, emulator.appleCommander);
  const acceptedConfig = resolve(cwd, emulator.acceptedConfig);
  await Promise.all([access(executable), access(template), access(jar), access(acceptedConfig)]);
  const acceptedVersion = /^Version=([^\r\n]+)$/mu.exec(await readFile(acceptedConfig, "utf8"))?.[1];
  if (!acceptedVersion) throw new Error("AppleWin acceptedConfig must record acceptance of the installed version's license.");
  await buildTarget({ ...options, target: "apple2", runTools: false, testOutputDevice: options.testOutputDevice ?? "text-printer" });
  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  const listingPath = outputPathFor(cwd, options.outDir, options.profile, "apple2", program.name, ".bas");
  const listing = await readFile(listingPath, "utf8");
  let expected = 0;
  if (options.testPrinterOutput) {
    const debug = JSON.parse(await readFile(outputPathFor(cwd, options.outDir, options.profile, "apple2", program.name, ".debug.json"), "utf8"));
    const sources = await Promise.all(debug.sourceFiles.map((file) => readFile(file, "utf8")));
    expected = sources.reduce((total, source) => total + [...source.matchAll(/^\s*test\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/gimu)].length, 0);
    if (!expected) throw new Error("AppleWin capture requires at least one selected test.");
  }
  const stagingRoot = resolve(cwd, options.outDir, ".applewin");
  await mkdir(stagingRoot, { recursive: true });
  const staging = await mkdtemp(join(stagingRoot, "launch-"));
  const disk = join(staging, "program.dsk"), ini = join(staging, "applewin.ini"), printer = join(staging, "printer.txt");
  await copyFile(template, disk);
  await chmod(disk, 0o666);
  const java = emulator.javaPath || "java";
  const run = (args, input) => {
    const result = spawnSync(java, ["-jar", jar, ...args], { cwd, input, encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0 || /(?:^|\n)Error:/u.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)) throw new Error(`AppleCommander failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  };
  run(["-u", disk, "HELLO"]);
  run(["-d", disk, "HELLO"]);
  run(["-bas", disk, "HELLO"], listing);
  await writeFile(ini, `[Configuration]\nApple2 Type=17\nVersion=${acceptedVersion}\nNo-Slot clock=1\n[Configuration\\Slot 1]\nCard type=4\nPrinter Filename=${printer}\nAppend to printer file=0\nConvert Encoding=1\nFilter Unprintable=1\n`, "ascii");
  if (options.restart) spawnSync("taskkill", ["/F", "/IM", basename(executable)], { cwd, stdio: "ignore", windowsHide: true });
  const child = spawn(executable, ["-conf", ini, "-d1", disk, "-s7", "empty", "-s1", "parallel", "-model", "apple2ee", "-noreg", "-no-printscreen-dlg", ...(options.testPrinterOutput ? ["-clock-multiplier", "3.9"] : [])], { cwd, detached: !options.testPrinterOutput, stdio: "ignore", windowsHide: options.hidden === true });
  await new Promise((done, fail) => { child.once("spawn", done); child.once("error", fail); });
  if (options.testPrinterOutput) {
    const deadline = Date.now() + Number(options.timeout ?? 180) * 1000;
    let captured = "";
    try {
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`AppleWin exited with code ${child.exitCode}; capture: ${printer}`);
        try { captured = await readFile(printer, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (captured.replace(/\s+/gu, "").toUpperCase().includes("METACONTROLPROGRAM(M.C.P.)RUNFINISHED") && /^FREE MEMORY:/imu.test(captured)) break;
        await new Promise((done) => setTimeout(done, 1000));
      }
      if (!verifyAppleWinCapture(captured, expected)) throw new Error(`AppleWin did not report a complete passing result; capture: ${printer}\n${captured}`);
      console.log(`captured ${printer}\n${captured}`);
      return { disk, ini, printer, captured, pid: child.pid };
    } finally {
      if (child.exitCode === null) child.kill();
    }
  }
  child.unref();
  console.log(`launched ${options.targetConfiguration} with ${disk} (process ${child.pid})`);
  console.log(`printer output: ${printer}`);
  console.log("AppleWin startup and program execution have not been verified by the launcher.");
  return { disk, ini, printer, pid: child.pid };
}

export async function runLaunchAppleWinCli() {
  try { await launchAppleWin(parseAppleWinArgs(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
