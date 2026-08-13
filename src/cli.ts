#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compileSource, type Target } from "./compiler.js";
import { formatCause } from "./diagnostics.js";

interface CliOptions {
  readonly inputPath: string;
  readonly target: Target;
  readonly outputPath?: string;
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    const source = await readFile(options.inputPath, "utf8");
    const output = compileSource(source, { filename: options.inputPath, target: options.target });

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
    throw new Error("Usage: meta-basic <source.mbas> --target spectrum [--output program.bas]");
  }

  if (!target) {
    throw new Error("Missing required --target spectrum option.");
  }

  return outputPath ? { inputPath, target, outputPath } : { inputPath, target };
}

main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
