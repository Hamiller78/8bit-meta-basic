#!/usr/bin/env node
// Run each instruction module on a disposable copy of a DOS 3.3 system disk.
import { spawn, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
const emulator = option("--emulator", undefined);
const diskTemplate = option("--disk", undefined);
const appleCommander = option("--applecommander", undefined);
const acceptedConfig = option("--accepted-config", undefined);
const selected = option("--module", undefined);
const timeoutMs = Number(option("--timeout", "120")) * 1000;
if (!emulator || !diskTemplate || !appleCommander || !acceptedConfig || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("Usage: node scripts/run-applewin-instruction-suite.mjs --emulator <exe> --disk <DOS 3.3 system disk> --applecommander <jar> --accepted-config <ini> [--module <name>] [--timeout seconds]");
}
const acceptedVersion = /^Version=([^\r\n]+)$/mu.exec(await readFile(resolve(acceptedConfig), "utf8"))?.[1];
if (!acceptedVersion) throw new Error("The AppleWin configuration does not record acceptance of a version's license.");
const project = "language-tests/instruction-suite";
const root = resolve("build/applewin-suite");
const modules = (await readdir(join(project, "tests"))).filter((file) => file.endsWith("-tests.mbas") && (!selected || file === `${selected}-tests.mbas` || file === `${selected}.mbas`)).sort();
if (!modules.length) throw new Error("No matching instruction modules.");
const failures = [];
const run = (exe, argv, input) => {
  const result = spawnSync(exe, argv, { input, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0 || /(?:^|\n)Error:/u.test(result.stderr ?? "")) throw new Error(`${exe} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
};
// Compile once before any module, so --skip-build below cannot use stale output.
run(process.execPath, ["node_modules/typescript/bin/tsc"]);
for (const file of modules) {
  const module = file.replace(/\.mbas$/u, "");
  const dir = join(root, module);
  const disk = join(dir, "test.dsk"), capture = join(dir, "capture.txt"), config = join(dir, "applewin.ini");
  let child;
  console.log(`AppleWin: ${module}`);
  try {
    await mkdir(dir, { recursive: true });
    run(process.execPath, ["scripts/build-target.mjs", "apple2", "--project", project, "--run-tests", "--module", module, "--profile", "release", "--printer-output", "--test-output-device", "text-printer", "--no-tools", "--skip-build", "--out-dir", dir]);
    const listing = await readFile(join(dir, "release", "apple2", "instruction-suite.bas"), "utf8");
    const source = await readFile(join(project, "tests", file), "utf8");
    const expected = [...source.matchAll(/^\s*test\s+[A-Za-z_][A-Za-z_0-9]*\s*\(/gimu)].length;
    if (!expected) throw new Error("No tests found in module source.");
    await copyFile(resolve(diskTemplate), disk);
    await chmod(disk, 0o666);
    run("java", ["-jar", resolve(appleCommander), "-u", disk, "HELLO"]);
    run("java", ["-jar", resolve(appleCommander), "-d", disk, "HELLO"]);
    run("java", ["-jar", resolve(appleCommander), "-bas", disk, "HELLO"], listing);
    await rm(capture, { force: true });
    await writeFile(config, `[Configuration]\nApple2 Type=17\nVersion=${acceptedVersion}\n[Configuration\\Slot 1]\nCard type=4\nPrinter Filename=${capture}\nAppend to printer file=0\nConvert Encoding=1\nFilter Unprintable=1\n`, "ascii");
    child = spawn(resolve(emulator), ["-conf", config, "-d1", disk, "-s7", "empty", "-s1", "parallel", "-model", "apple2ee", "-noreg", "-no-printscreen-dlg", "-clock-multiplier", "3.9"], { windowsHide: true, stdio: "ignore" });
    let spawnError;
    child.on("error", (error) => { spawnError = error; });
    const deadline = Date.now() + timeoutMs;
    let text = "";
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`AppleWin exited with code ${child.exitCode}.`);
      try { text = await readFile(capture, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (/RUN FINISHED/iu.test(text) && /^FREE MEMORY:/imu.test(text)) break;
      await new Promise((done) => setTimeout(done, 1000));
    }
    const count = (key) => Number(new RegExp(`^${key}:\\s*(\\d+)`, "imu").exec(text)?.[1] ?? NaN);
    if (!/RUN FINISHED/iu.test(text) || !/^FREE MEMORY:/imu.test(text) || count("TESTS") !== expected || count("PASSED") !== expected || count("FAILED") !== 0 || count("FAILURES") !== 0 || !Number.isFinite(count("ASSERTIONS"))) {
      throw new Error(`Incomplete or failed capture (expected ${expected} tests): ${capture}`);
    }
    console.log(`  PASS: ${expected} tests, ${count("ASSERTIONS")} assertions; ${capture}`);
  } catch (error) {
    failures.push(module);
    console.error(`  UNVERIFIED/FAILED: ${error.message}`);
  } finally {
    if (child && child.exitCode === null) child.kill();
  }
}
if (failures.length) { console.error(`Modules needing investigation: ${failures.join(", ")}`); process.exitCode = 1; }
