#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildProject } from "./lib/build-target.mjs";
import { launchKc85 } from "./lib/launch-kc85.mjs";

let configPath = "scripts/tools.local.json";
let hidden = false;
let runBuild = true;
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const argv = process.argv.slice(2);
  if (argv[index] === "--config" && argv[index + 1]) configPath = argv[++index];
  else if (argv[index] === "--hidden") hidden = true;
  else if (argv[index] === "--skip-build") runBuild = false;
  else throw new Error(`Unknown or incomplete option: ${argv[index]}`);
}
if (runBuild) await buildProject();
const projectPath = "language-tests/instruction-suite";
const modules = (await readdir(resolve(projectPath, "tests"))).filter((name) => name.endsWith("-tests.mbas")).sort();
const totals = { TESTS: 0, PASSED: 0, FAILED: 0, ASSERTIONS: 0, FAILURES: 0 };
const failed = [];
for (const file of modules) {
  const moduleName = file.replace(/\.mbas$/u, "");
  console.log(`\nKC 85 instruction module: ${moduleName}`);
  try {
    const result = await launchKc85({ source: "examples/colors.mbas", profile: "release", outDir: `build/kc85-suite/${moduleName}`,
      configPath, targetConfiguration: "kc85", runBuild: false, testMode: true, capture: true, hidden, projectPath, moduleName });
    for (const key of Object.keys(totals)) totals[key] += Number(new RegExp(`^${key}:\\s*(\\d+)`, "mu").exec(result.captured)?.[1] ?? 0);
  } catch (error) {
    failed.push(moduleName);
    console.error(error instanceof Error ? error.message : String(error));
  }
}
console.log("\nKC 85 INSTRUCTION SUITE RESULTS");
for (const [key, value] of Object.entries(totals)) console.log(`${key}: ${value}`);
if (failed.length) { console.error(`Unverified or failed modules: ${failed.join(", ")}`); process.exitCode = 1; }
