#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createCpcDataDisk } from "./lib/cpc-disk.mjs";

const [inputPath, outputPath, filename = "MAIN.BAS", ...extra] = process.argv.slice(2);
if (!inputPath || !outputPath || extra.length) {
  console.error("Usage: node scripts/package-cpc-disk.mjs <input.bas> <output.dsk> [CPCNAME.BAS]");
  process.exitCode = 1;
} else {
  try {
    const listing = await readFile(inputPath, "utf8");
    await writeFile(outputPath, createCpcDataDisk(filename, listing));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
