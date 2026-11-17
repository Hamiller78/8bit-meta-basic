import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTarget, outputPathFor, programIdentity } from "./build-target.mjs";
import { kc85AutoInputProfile, kc85AutoLoadProfile } from "./jkcemu.mjs";
import { loadToolConfiguration, resolveTargetConfiguration } from "../target-configurations.mjs";

export async function launchKc85(options) {
  if (process.platform !== "win32") throw new Error("JKCEMU launch currently supports Windows only.");
  const cwd = options.cwd ?? process.cwd();
  const config = await loadToolConfiguration(cwd, options.configPath);
  const target = resolveTargetConfiguration(config, options.targetConfiguration, { compilerTarget: "kc85", emulatorType: "jkcemu" });
  const emulator = target.emulator;
  if (!emulator.path) throw new Error(`No JKCEMU JAR configured for "${options.targetConfiguration}".`);
  const jar = resolve(cwd, emulator.path);
  await access(jar); // Fail before building or launching when the configured JAR is missing.
  const java = emulator.javaPath ? resolve(cwd, emulator.javaPath) : "javaw";
  const consoleJava = java.replace(/javaw(?:\.exe)?$/iu, (value) => value.replace(/javaw/iu, "java"));
  const { stdout } = await promisify(execFile)(consoleJava, ["-jar", jar, "--version"], { windowsHide: true });
  const version = /JKCEMU Version\s+(\S+)/u.exec(stdout)?.[1];
  if (version !== "0.9.9.1") throw new Error(`JKCEMU version ${version ?? "unknown"} is unsupported; this launcher requires 0.9.9.1.`);
  await buildTarget({ ...options, target: "kc85", runTools: false, testPrinterOutput: false });
  const program = programIdentity(cwd, options.source, options.buildConfigPath, options.projectPath);
  const basicPath = outputPathFor(cwd, options.outDir, options.profile, "kc85", program.name, ".bas");
  const tokenizedPath = outputPathFor(cwd, options.outDir, options.profile, "kc85", program.name, ".sss");
  const stagingRoot = resolve(cwd, options.outDir, ".jkcemu");
  await mkdir(stagingRoot, { recursive: true });
  const appData = await mkdtemp(join(stagingRoot, "launch-"));
  const profileDir = join(appData, "jkcemu");
  await mkdir(profileDir);
  const stagedBasic = join(appData, "program.sss");
  const useAutoLoad = options.fastLoad || options.capture;
  if (useAutoLoad) await copyFile(tokenizedPath, stagedBasic);
  const profile = useAutoLoad
    ? kc85AutoLoadProfile(stagedBasic, version)
    : kc85AutoInputProfile(await readFile(basicPath, "utf8"), version);
  await writeFile(join(profileDir, "prf_metabasic.xml"), profile, "utf8");
  if (options.capture) {
    const debugPath = outputPathFor(cwd, options.outDir, options.profile, "kc85", program.name, ".debug.json");
    const debug = JSON.parse(await readFile(debugPath, "utf8"));
    const sources = await Promise.all(debug.sourceFiles.map((file) => readFile(file, "utf8")));
    const expected = sources.reduce((count, source) => count + [...source.matchAll(/^\s*test\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/gimu)].length, 0);
    if (!expected) throw new Error("KC 85 capture requires at least one selected test.");
    const capturePath = join(appData, "screen.txt");
    const helper = fileURLToPath(new URL("../JkcScreenCapture.java", import.meta.url));
    const child = spawn(consoleJava, ["-cp", jar, helper, capturePath, String(options.timeoutMs ?? 180000)], {
      cwd, env: { ...process.env, APPDATA: appData }, stdio: "inherit", windowsHide: options.hidden === true
    });
    const code = await new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", resolveExit);
    });
    if (code !== 0) {
      let partial = "";
      try { partial = await readFile(capturePath, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      throw new Error(`JKCEMU capture exited with code ${code ?? "unknown"}; partial screen: ${capturePath}\n${partial}`);
    }
    const captured = await readFile(capturePath, "utf8");
    const field = (label) => Number(new RegExp(`^${label}:\\s*(\\d+)`, "mu").exec(captured)?.[1] ?? NaN);
    if (!captured.replace(/\s+/gu, "").includes("METACONTROLPROGRAM(M.C.P.)RUNFINISHED") ||
        field("TESTS") !== expected || field("PASSED") !== expected || field("FAILED") !== 0 ||
        !Number.isFinite(field("ASSERTIONS")) || field("FAILURES") !== 0 || !Number.isFinite(field("FREE MEMORY"))) {
      throw new Error(`KC 85 test runner did not report a complete passing result; capture: ${capturePath}\n${captured}`);
    }
    console.log(`captured ${capturePath}\n${captured}`);
    return { capturePath, captured };
  }
  const child = spawn(java, ["-jar", jar, "metabasic"], {
    cwd, env: { ...process.env, APPDATA: appData }, stdio: "ignore", detached: true, windowsHide: false
  });
  await new Promise((resolveStart, rejectStart) => {
    child.once("spawn", resolveStart);
    child.once("error", rejectStart);
  });
  child.unref();
  console.log(`launched ${options.targetConfiguration} with ${useAutoLoad ? `AutoLoad from ${tokenizedPath}` : `AutoInput from ${basicPath}`} (process ${child.pid})`);
  console.log("JKCEMU startup and program execution have not been verified by the launcher.");
}

export function parseKc85Args(argv) {
  const defaultSource = "examples/struct-demo.mbas";
  const options = { source: defaultSource, profile: "release", outDir: "build", configPath: "scripts/tools.local.json", targetConfiguration: "kc85", runBuild: true, fastLoad: true };
  const valued = { "--source": "source", "--build-config": "buildConfigPath", "--project": "projectPath", "--module": "moduleName", "--profile": "profile", "--out-dir": "outDir", "--config": "configPath", "--target-configuration": "targetConfiguration", "--language": "language", "--font": "font" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (Object.hasOwn(valued, arg)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[valued[arg]] = argv[++index];
    } else if (arg === "--skip-build") options.runBuild = false;
    else if (arg === "--fast-load") options.fastLoad = true;
    else if (arg === "--type-in") options.fastLoad = false;
    else if (arg === "--run-tests") options.testMode = true;
    else if (arg === "--test-screen-output") options.testScreenOutput = true;
    else if (arg === "--printer-output") options.capture = true;
    else if (arg === "--hidden") options.hidden = true;
    else throw new Error(`Unsupported KC 85 launch option "${arg}".`);
  }
  if ([options.source !== defaultSource, Boolean(options.buildConfigPath), Boolean(options.projectPath)].filter(Boolean).length > 1) {
    throw new Error("Select only one of --source, --build-config, or --project.");
  }
  if (options.moduleName && (!options.projectPath || !options.testMode)) throw new Error("--module requires --project and --run-tests.");
  if (options.capture && !options.testMode) throw new Error("--printer-output requires --run-tests.");
  return options;
}

export async function runLaunchKc85Cli() {
  try { await launchKc85(parseKc85Args(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
