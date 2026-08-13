#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compileSource, type Target } from "./compiler.js";
import { formatCause } from "./diagnostics.js";
import type { CommentLevel } from "./line-numbering.js";

interface CliOptions {
  readonly inputPath: string;
  readonly target: Target;
  readonly comments: CommentLevel;
  readonly outputPath?: string;
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    const source = await readFile(options.inputPath, "utf8");
    const output = compileSource(source, {
      filename: options.inputPath,
      target: options.target,
      comments: options.comments
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
  let comments: CommentLevel = 2;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --target.");
      }
      if (value !== "spectrum") {
        throw new Error(`Unsupported target "${value}". Only "spectrum" is supported.`);
      }
      target = value;
      index += 1;
      continue;
    }

    if (arg === "--comments") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --comments.");
      }
      comments = parseCommentLevel(value);
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
    throw new Error("Usage: meta-basic <source.mbas> --target spectrum [--comments 0|1|2] [--output program.bas]");
  }

  if (!target) {
    throw new Error("Missing required --target spectrum option.");
  }

  return outputPath ? { inputPath, target, comments, outputPath } : { inputPath, target, comments };
}

function parseCommentLevel(value: string): CommentLevel {
  if (value === "0" || value === "1" || value === "2") {
    return Number(value) as CommentLevel;
  }

  throw new Error(`Invalid --comments value "${value}". Expected 0, 1, or 2.`);
}

main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
