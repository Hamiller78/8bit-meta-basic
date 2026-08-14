#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compileSource, type Target } from "./compiler.js";
import { formatCause } from "./diagnostics.js";
import type { ReadabilityLevel } from "./line-numbering.js";
import { isTargetId } from "./targets/index.js";

interface CliOptions {
  readonly inputPath: string;
  readonly target: Target;
  readonly readability: ReadabilityLevel;
  readonly outputPath?: string;
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    const source = await readFile(options.inputPath, "utf8");
    const output = compileSource(source, {
      filename: options.inputPath,
      target: options.target,
      readability: options.readability
    });

    if (options.outputPath) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, output, "utf8");
    } else {
      process.stdout.write(output);
    }

    return 0;
  } catch (error) {
    process.stderr.write(`${formatCause(error)}\n`);
    return 1;
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
  let inputPath: string | undefined;
  let target: Target | undefined;
  let readability: ReadabilityLevel = 2;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --target.");
      }
      if (!isTargetId(value)) {
        throw new Error(`Unsupported target "${value}". Supported targets are "spectrum", "atari800xl", and "c64".`);
      }
      target = value;
      index += 1;
      continue;
    }

    if (arg === "--readability" || arg === "--comments") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}.`);
      }
      readability = parseReadabilityLevel(value, arg);
      index += 1;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}.`);
      }
      outputPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    }

    if (inputPath) {
      throw new Error(`Unexpected extra input "${arg}".`);
    }
    inputPath = arg;
  }

  if (!inputPath) {
    throw new Error("Usage: meta-basic <source.mbas> --target spectrum|atari800xl|c64 [--readability 0|1|2] [--output program.bas]");
  }

  if (!target) {
    throw new Error("Missing required --target option.");
  }

  return outputPath ? { inputPath, target, readability, outputPath } : { inputPath, target, readability };
}

function parseReadabilityLevel(value: string, optionName: string): ReadabilityLevel {
  if (value === "0" || value === "1" || value === "2") {
    return Number(value) as ReadabilityLevel;
  }

  throw new Error(`Invalid ${optionName} value "${value}". Expected 0, 1, or 2.`);
}

main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
