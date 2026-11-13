#!/usr/bin/env node
import { copyFile, readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildProject } from "./lib/build-target.mjs";
import { capriceSpawnOptions, launchCpc } from "./lib/launch-cpc.mjs";

const argv = process.argv.slice(2);
let configPath = "scripts/tools.local.json";
let hidden = false;
let runBuild = true;
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--config" && argv[index + 1]) configPath = argv[++index];
  else if (argv[index] === "--hidden") hidden = true;
  else if (argv[index] === "--skip-build") runBuild = false;
  else throw new Error(`Unknown or incomplete option: ${argv[index]}`);
}
capriceSpawnOptions(hidden);
if (runBuild) await buildProject();
const projectPath = "language-tests/instruction-suite";
const modules = (await readdir(resolve(projectPath, "tests"))).filter((name) => name.endsWith("-tests.mbas")).sort();
const output = resolve("build/printer/release/cpc/instruction-suite.txt");
const totals = { TESTS: 0, PASSED: 0, FAILED: 0, ASSERTIONS: 0, FAILURES: 0 };
const failed = [];
for (const file of modules) {
  const moduleName = file.replace(/\.mbas$/u, "");
  console.log(`\nCPC instruction module: ${moduleName}`);
  await rm(output, { force: true });
  try {
    await launchCpc({ source: "examples/colors.mbas", profile: "release", outDir: "build", configPath,
      targetConfiguration: "cpc", runBuild: false, testMode: true, testPrinterOutput: true, hidden, projectPath, moduleName });
    const text = await readFile(output, "utf8");
    for (const key of Object.keys(totals)) totals[key] += Number(new RegExp(`^${key}:\\s*(\\d+)`, "mu").exec(text)?.[1] ?? 0);
  } catch (error) {
    failed.push(moduleName);
    console.error(error instanceof Error ? error.message : String(error));
  }
  try { await copyFile(output, resolve(`build/printer/release/cpc/${moduleName}.txt`)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
console.log("\nCPC INSTRUCTION SUITE RESULTS");
for (const [key, value] of Object.entries(totals)) console.log(`${key}: ${value}`);
if (failed.length) { console.error(`Unverified or failed modules: ${failed.join(", ")}`); process.exitCode = 1; }
