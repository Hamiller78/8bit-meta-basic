import { requireLanguage, requireTextFont, type TextFont } from "./text-support.js";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Program } from "./ast.js";
import { compileProgramDetailed, type CompileOptions, type CompileResult } from "./compiler.js";
import { deviceCliList, isDeviceKind, type DeviceKind } from "./devices.js";
import { parseSource } from "./parser.js";

export interface BuildConfiguration {
  readonly textsDir?: string;
  readonly language?: string;
  readonly font?: TextFont;
  readonly files: readonly string[];
  readonly testMode?: boolean;
  readonly testPrinterOutput?: boolean;
  readonly testOutputDevice?: DeviceKind;
}

export interface BuildOptions extends Omit<CompileOptions, "filename"> {
  readonly textsDir?: string;
  readonly configPath?: string;
  readonly baseDir?: string;
}

export async function loadBuildConfiguration(configPath: string): Promise<BuildConfiguration> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Build configuration file not found: ${configPath}.`);
    }
    throw new Error(`Cannot read build configuration file "${configPath}": ${formatErrorMessage(error)}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in build configuration "${configPath}": ${formatErrorMessage(error)}.`);
  }

  return validateBuildConfiguration(parsed, configPath);
}

export async function build(configuration: BuildConfiguration, options: BuildOptions): Promise<string> {
  return (await buildDetailed(configuration, options)).output;
}

export async function buildDetailed(configuration: BuildConfiguration, options: BuildOptions): Promise<CompileResult> {
  const baseDir = options.baseDir ?? (options.configPath ? dirname(resolve(options.configPath)) : process.cwd());
  const program = await readBuildProgram(configuration, baseDir);
  return compileProgramDetailed(program, {
    texts: options.texts ?? await loadTexts(options.textsDir ?? (configuration.textsDir ? resolve(baseDir, configuration.textsDir) : resolve(baseDir, "texts")), options.language ?? configuration.language ?? "en"),
    language: options.language ?? configuration.language ?? "en",
    font: options.font ?? configuration.font,
    filename: options.configPath ?? "<build configuration>",
    target: options.target,
    readability: options.readability,
    comments: options.comments,
    testMode: options.testMode ?? configuration.testMode,
    testPrinterOutput: options.testPrinterOutput ?? configuration.testPrinterOutput,
    testOutputDevice: options.testOutputDevice ?? configuration.testOutputDevice,
    atariSharedDriveSpec: options.atariSharedDriveSpec
  });
}

export async function compileBuildConfiguration(configuration: BuildConfiguration, options: BuildOptions): Promise<string> {
  return build(configuration, options);
}

function validateBuildConfiguration(value: unknown, configPath: string): BuildConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid build configuration "${configPath}": expected a JSON object.`);
  }

  const files = (value as { files?: unknown }).files;
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string" || file.length === 0)) {
    throw new Error(`Invalid build configuration "${configPath}": "files" must be an array of source file paths.`);
  }
  if (files.length === 0) {
    throw new Error(`Invalid build configuration "${configPath}": "files" must contain at least one source file.`);
  }

  const testMode = (value as { testMode?: unknown }).testMode;
  if (testMode !== undefined && typeof testMode !== "boolean") {
    throw new Error(`Invalid build configuration "${configPath}": "testMode" must be a boolean when present.`);
  }
  const testPrinterOutput = (value as { testPrinterOutput?: unknown }).testPrinterOutput;
  if (testPrinterOutput !== undefined && typeof testPrinterOutput !== "boolean") {
    throw new Error(`Invalid build configuration "${configPath}": "testPrinterOutput" must be a boolean when present.`);
  }
  const testOutputDevice = (value as { testOutputDevice?: unknown }).testOutputDevice;
  if (testOutputDevice !== undefined && !isDeviceKind(testOutputDevice)) {
    throw new Error(`Invalid build configuration "${configPath}": "testOutputDevice" must be ${deviceCliList} when present.`);
  }

  const { textsDir, language, font } = value as { textsDir?: unknown; language?: unknown; font?: unknown };
  for (const [name, field] of Object.entries({ textsDir, language, font })) {
    if (field !== undefined && (typeof field !== "string" || !field)) throw new Error(`Invalid build configuration "${configPath}": "${name}" must be a nonempty string.`);
  }
  return {
    ...(textsDir !== undefined ? { textsDir: textsDir as string } : {}),
    ...(language !== undefined ? { language: requireLanguage(language as string) } : {}),
    ...(font !== undefined ? { font: requireTextFont(font as string) } : {}),
    files,
    ...(testMode !== undefined ? { testMode } : {}),
    ...(testPrinterOutput !== undefined ? { testPrinterOutput } : {}),
    ...(testOutputDevice !== undefined ? { testOutputDevice } : {})
  };
}

async function readBuildProgram(configuration: BuildConfiguration, baseDir: string): Promise<Program> {
  const statements: Program["statements"][number][] = [];

  for (const file of configuration.files) {
    const sourcePath = resolve(baseDir, file);
    await ensureReadableFile(sourcePath, file);
    const source = await readFile(sourcePath, "utf8");
    statements.push(...parseSource(ensureTrailingNewline(source), sourcePath).statements);
  }

  return { statements };
}

function ensureTrailingNewline(source: string): string {
  return source.endsWith("\n") || source.endsWith("\r") ? source : `${source}\n`;
}

async function ensureReadableFile(sourcePath: string, configuredPath: string): Promise<void> {
  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Configured source file not found: ${configuredPath}.`);
    }
    throw new Error(`Cannot access configured source file "${configuredPath}": ${formatErrorMessage(error)}.`);
  }

  if (!sourceStat.isFile()) {
    throw new Error(`Configured source path is not a readable file: ${configuredPath}.`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadTexts(textsDir: string, language: string): Promise<Readonly<Record<string, string>>> {
  const directory = resolve(textsDir, requireLanguage(language));
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (isNodeError(error) && error.code === "ENOENT") return {}; throw error; }
  const texts: Record<string, string> = Object.create(null);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name.endsWith(".txt")) texts[entry.name.slice(0, -4)] = await readFile(resolve(directory, entry.name), "utf8");
  }
  return texts;
}
