#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const modules = [
  "colors-tests",
  "data-tests",
  "expressions-tests",
  "flow-tests",
  "functions-tests",
  "runtime-tests",
  "screen-tests",
  "storage-tests",
  "strings-tests",
  "text-tests"
];

const cwd = process.cwd();
const outputPath = resolve(cwd, "build/rs232/release/vic20/instruction-suite.txt");

await run(process.execPath, [resolve(cwd, "node_modules/typescript/bin/tsc")]);

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalAssertions = 0;
let totalFailures = 0;

for (const moduleName of modules) {
  console.log(`\nVIC-20 instruction module: ${moduleName}`);
  await run(process.execPath, [
    resolve(cwd, "scripts/launch-target.mjs"),
    "vic20",
    "--project", "language-tests/instruction-suite",
    "--run-tests",
    "--profile", "release",
    "--printer-output",
    "--module", moduleName,
    "--restart",
    "--skip-build"
  ]);
  const output = await waitForFinishedOutput(outputPath, moduleName);
  const summary = parseSummary(output, moduleName);
  totalTests += summary.tests;
  totalPassed += summary.passed;
  totalFailed += summary.failed;
  totalAssertions += summary.assertions;
  totalFailures += summary.failures;
  console.log(`  TESTS ${summary.tests}, PASSED ${summary.passed}, FAILED ${summary.failed}, ASSERTIONS ${summary.assertions}, FAILURES ${summary.failures}`);
}

console.log("\nVIC-20 INSTRUCTION SUITE FINISHED");
console.log(`TESTS: ${totalTests}`);
console.log(`PASSED: ${totalPassed}`);
console.log(`FAILED: ${totalFailed}`);
console.log(`ASSERTIONS: ${totalAssertions}`);
console.log(`FAILURES: ${totalFailures}`);
if (totalFailed !== 0 || totalFailures !== 0) process.exitCode = 1;

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: false });
    child.on("error", rejectRun);
    child.on("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with code ${code ?? "unknown"}.`)));
  });
}

async function waitForFinishedOutput(path, moduleName) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const output = await readFile(path, "utf8");
      if (output.includes("RUN FINISHED") && /^FAILURES:\s+\d+/m.test(output)) return output;
    } catch {
      // The launcher creates the capture file asynchronously.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for RUN FINISHED from VIC-20 module ${moduleName}.`);
}

function parseSummary(output, moduleName) {
  const value = (label) => {
    const match = output.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"));
    if (!match) throw new Error(`Missing ${label} summary for VIC-20 module ${moduleName}.`);
    return Number(match[1]);
  };
  return {
    tests: value("TESTS"),
    passed: value("PASSED"),
    failed: value("FAILED"),
    assertions: value("ASSERTIONS"),
    failures: value("FAILURES")
  };
}
