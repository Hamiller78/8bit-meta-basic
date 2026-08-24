#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildDetailed, loadBuildConfiguration } from "./build-configuration.js";
import { compileSourceDetailed, type Target } from "./compiler.js";
import { formatCause } from "./diagnostics.js";
import type { ReadabilityLevel } from "./line-numbering.js";
import { formatOutputStats } from "./output-stats.js";
import { isTargetId } from "./targets/index.js";
import type { DeviceKind } from "./ast.js";

interface CliOptions {
  readonly inputPath?: string;
  readonly configPath?: string;
  readonly target: Target;
  readonly readability: ReadabilityLevel;
  readonly outputPath?: string;
  readonly testMode?: boolean;
  readonly testPrinterOutput?: boolean;
  readonly testOutputDevice?: DeviceKind;
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    const result = options.configPath
      ? await buildDetailed(await loadBuildConfiguration(options.configPath), {
          configPath: options.configPath,
          target: options.target,
          readability: options.readability,
          testMode: options.testMode,
          testPrinterOutput: options.testPrinterOutput,
          testOutputDevice: options.testOutputDevice
        })
      : compileSourceDetailed(await readFile(requiredInputPath(options), "utf8"), {
          filename: requiredInputPath(options),
          target: options.target,
          readability: options.readability,
          testMode: options.testMode,
          testPrinterOutput: options.testPrinterOutput,
          testOutputDevice: options.testOutputDevice
        });

    if (options.outputPath) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, result.output, "utf8");
      process.stderr.write(`${formatOutputStats(result.stats)}\n`);
    } else {
      process.stdout.write(result.output);
    }

    return 0;
  } catch (error) {
    process.stderr.write(`${formatCause(error)}\n`);
    return 1;
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
  let inputPath: string | undefined;
  let configPath: string | undefined;
  let target: Target | undefined;
  let readability: ReadabilityLevel = 2;
  let outputPath: string | undefined;
  let testMode = false;
  let testPrinterOutput = false;
  let testOutputDevice: DeviceKind = "printer";

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

    if (arg === "--run-tests") {
      testMode = true;
      continue;
    }

    if (arg === "--printer-output") {
      testPrinterOutput = true;
      continue;
    }

    if (arg === "--test-output-device") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}.`);
      }
      testOutputDevice = parseDeviceKind(value);
      index += 1;
      continue;
    }

    if (arg === "--config" || arg === "--build-config") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}.`);
      }
      configPath = value;
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

  if (!inputPath && !configPath) {
    throw new Error("Usage: meta-basic <source.mbas>|--config metabasic.json --target spectrum|atari800xl|c64 [--readability 0|1|2] [--output program.bas] [--run-tests] [--printer-output] [--test-output-device printer|text-printer|rs232]");
  }

  if (inputPath && configPath) {
    throw new Error("Specify either one source file or --config, not both.");
  }

  if (!target) {
    throw new Error("Missing required --target option.");
  }

  const parsed: CliOptions = configPath
    ? { configPath, target, readability, testMode, testPrinterOutput }
    : { inputPath: inputPath ?? "", target, readability, testMode, testPrinterOutput };
  const parsedWithDevice = { ...parsed, testOutputDevice };
  return outputPath ? { ...parsedWithDevice, outputPath } : parsedWithDevice;
}

function requiredInputPath(options: CliOptions): string {
  if (!options.inputPath) {
    throw new Error("Internal error: missing source input path.");
  }
  return options.inputPath;
}

function parseReadabilityLevel(value: string, optionName: string): ReadabilityLevel {
  if (value === "0" || value === "1" || value === "2") {
    return Number(value) as ReadabilityLevel;
  }

  throw new Error(`Invalid ${optionName} value "${value}". Expected 0, 1, or 2.`);
}

function parseDeviceKind(value: string): DeviceKind {
  const normalized = value.toLowerCase();
  if (normalized === "printer" || normalized === "text-printer" || normalized === "rs232") {
    return normalized;
  }
  throw new Error(`Invalid --test-output-device value "${value}". Expected printer, text-printer, or rs232.`);
}

main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
