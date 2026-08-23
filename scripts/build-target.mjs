#!/usr/bin/env node
import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

export const targets = ["spectrum", "atari800xl", "c64"];
export const profiles = {
  debug: 2,
  balanced: 1,
  release: 0
};

const defaultSource = "examples/colors.mbas";
const defaultOutDir = "build";
const defaultToolConfig = "scripts/tools.local.json";

export async function buildProject({ cwd = process.cwd() } = {}) {
  const npm = npmCommand();
  await run(npm.command, npm.args, { cwd });
}

export async function buildTarget(options) {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target;
  const profile = options.profile ?? "debug";
  const source = options.source ?? defaultSource;
  let buildConfigPath = options.buildConfigPath;
  const projectPath = options.projectPath;
  const testMode = options.testMode === true;
  const testPrinterOutput = options.testPrinterOutput === true;
  const testOutputDevice = options.testOutputDevice ?? "printer";
  const moduleName = options.moduleName;
  const outDir = options.outDir ?? defaultOutDir;
  const configPath = options.configPath ?? defaultToolConfig;
  const runBuild = options.runBuild ?? true;
  const runTools = options.runTools ?? true;

  if (!targets.includes(target)) {
    throw new Error(`Unknown target "${target}". Expected one of: ${targets.join(", ")}.`);
  }
  if (!Object.hasOwn(profiles, profile)) {
    throw new Error(`Unknown profile "${profile}". Expected one of: ${Object.keys(profiles).join(", ")}.`);
  }

  if (runBuild) {
    await buildProject({ cwd });
  }

  if (projectPath) {
    buildConfigPath = await writeProjectBuildConfig({ cwd, projectPath, outDir, testMode, testPrinterOutput, testOutputDevice, moduleName });
  }

  const program = programIdentity(cwd, source, buildConfigPath, projectPath);
  const basicPath = outputPathFor(cwd, outDir, profile, target, program.name, ".bas");
  const artifacts = {
    basic: basicPath
  };
  await mkdir(dirname(basicPath), { recursive: true });

  await run(
    process.execPath,
    [
      "dist/cli.js",
      ...(buildConfigPath ? ["--config", program.inputPath] : [program.inputPath]),
      "--target",
      target,
      "--readability",
      profiles[profile].toString(),
      "--output",
      basicPath,
      ...(testMode ? ["--run-tests"] : []),
      ...(testPrinterOutput ? ["--printer-output", "--test-output-device", testOutputDevice] : [])
    ],
    { cwd }
  );

  console.log(`created ${relativeToCwd(cwd, basicPath)}`);

  if (target === "atari800xl") {
    const listingPath = outputPathFor(cwd, outDir, profile, target, program.name, ".lst");
    await writeAtariListing({ basicPath, listingPath });
    artifacts.atariListing = listingPath;
    console.log(`created ${relativeToCwd(cwd, listingPath)}`);

    const diskDirectoryPath = outputPathFor(cwd, outDir, profile, target, program.name, ".atr-files");
    await writeAtariDiskDirectory({ listingPath, diskDirectoryPath, sourceName: program.name });
    artifacts.atariDiskDirectory = diskDirectoryPath;
    console.log(`created ${relativeToCwd(cwd, diskDirectoryPath)}`);
  }

  if (runTools) {
    await runConfiguredTools({ cwd, configPath, target, profile, program, artifacts, outDir });
  }

  return basicPath;
}

async function writeAtariListing({ basicPath, listingPath }) {
  const text = await readFile(basicPath, "utf8");
  await writeFile(listingPath, toAtariListingBytes(text));
}

async function writeAtariDiskDirectory({ listingPath, diskDirectoryPath, sourceName }) {
  await mkdir(diskDirectoryPath, { recursive: true });
  const listing = await readFile(listingPath);
  const listingName = toAtariDosFileName(sourceName, "LST");
  await writeFile(resolve(diskDirectoryPath, listingName), listing);
}

export function toAtariDosFileName(name, extension) {
  const baseName = toAtariDosNamePart(name, 8);
  const extensionName = toAtariDosNamePart(extension, 3);
  return extensionName ? `${baseName}.${extensionName}` : baseName;
}

function toAtariDosNamePart(value, maxLength) {
  const normalized = value.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  return (normalized || "PROGRAM").slice(0, maxLength);
}

export function toAtariListingBytes(text) {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const bytes = [];

  for (const char of normalized) {
    if (char === "\n") {
      bytes.push(0x9b);
      continue;
    }

    const code = char.codePointAt(0);
    if (code === undefined || code > 0x7f) {
      throw new Error("Atari LST output only supports ASCII text for now.");
    }
    bytes.push(code);
  }

  return Buffer.from(bytes);
}

async function runConfiguredTools({ cwd, configPath, target, profile, program, artifacts, outDir }) {
  const config = await loadToolConfig(resolve(cwd, configPath));
  const tools = normalizeTools(config?.[target]);

  for (const tool of tools) {
    if (!tool.path) {
      continue;
    }

    const toolPath = resolveMaybe(cwd, tool.path);
    if (!(await exists(toolPath))) {
      console.warn(`skipped ${tool.name}: configured tool not found at ${tool.path}`);
      continue;
    }

    const outputPath = outputPathFor(cwd, outDir, profile, target, program.name, tool.outputExtension ?? ".out");
    await mkdir(dirname(outputPath), { recursive: true });

    const inputPath = selectToolInput({ tool, artifacts });
    const toolInputPath = await prepareToolInput({ tool, inputPath, outputPath });
    const replacements = {
      input: toolInputPath,
      output: outputPath,
      source: program.inputPath,
      sourceName: program.name,
      profile,
      target
    };
    const args = (tool.args ?? ["{input}", "{output}"]).map((arg) => replacePlaceholders(arg, replacements));
    await run(toolPath, args, { cwd });
    artifacts[tool.name] = outputPath;

    if (tool.copyToArtifact) {
      await copyToolOutputToArtifact({ cwd, tool, sourceName: program.name, outputPath, artifacts });
    }

    console.log(`created ${relativeToCwd(cwd, outputPath)}`);
  }
}

async function copyToolOutputToArtifact({ cwd, tool, sourceName, outputPath, artifacts }) {
  const destinationDirectory = artifacts[tool.copyToArtifact];
  if (!destinationDirectory) {
    throw new Error(`Unknown tool copy destination artifact "${tool.copyToArtifact}".`);
  }

  const extension = tool.copyExtension ?? tool.outputExtension ?? "OUT";
  const destinationName = toAtariDosFileName(sourceName, extension);
  const destinationPath = resolve(destinationDirectory, destinationName);
  await copyFile(outputPath, destinationPath);
  console.log(`created ${relativeToCwd(cwd, destinationPath)}`);
}

function selectToolInput({ tool, artifacts }) {
  const inputArtifact = tool.inputArtifact ?? "basic";
  const inputPath = artifacts[inputArtifact];
  if (!inputPath) {
    throw new Error(`Unknown tool input artifact "${inputArtifact}".`);
  }
  return inputPath;
}

async function prepareToolInput({ tool, inputPath, outputPath }) {
  if (!tool.inputTransform) {
    return inputPath;
  }

  const text = await readFile(inputPath, "utf8");
  const transformed = transformInput(text, tool.inputTransform);
  const transformedPath = outputPath.replace(/\.[^.\\/]+$/, `.${tool.name}.input.bas`);
  await writeFile(transformedPath, transformed, "utf8");
  return transformedPath;
}

function transformInput(text, transform) {
  if (transform === "lowercase") {
    return text.toLowerCase();
  }

  throw new Error(`Unknown tool input transform "${transform}".`);
}

async function loadToolConfig(configPath) {
  if (!(await exists(configPath))) {
    return undefined;
  }

  const text = await readFile(configPath, "utf8");
  return JSON.parse(text);
}

function normalizeTools(targetConfig) {
  if (!targetConfig) {
    return [];
  }
  if (Array.isArray(targetConfig.tools)) {
    return targetConfig.tools;
  }

  return Object.entries(targetConfig)
    .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
    .map(([name, value]) => ({ name, ...value }));
}

export function outputPathFor(cwd, outDir, profile, target, name, extension) {
  return resolve(cwd, outDir, profile, target, `${name}${extension}`);
}

export function programIdentity(cwd, source, buildConfigPath, projectPath) {
  if (projectPath) {
    const inputPath = resolve(cwd, buildConfigPath ?? projectPath);
    return {
      inputPath,
      name: basename(resolve(cwd, projectPath))
    };
  }

  const inputPath = resolve(cwd, buildConfigPath ?? source);
  if (!buildConfigPath) {
    return {
      inputPath,
      name: basename(source, extname(source))
    };
  }

  const rawName = basename(buildConfigPath, extname(buildConfigPath));
  return {
    inputPath,
    name: rawName.toLowerCase() === "metabasic" ? basename(dirname(inputPath)) : rawName
  };
}

export async function writeProjectBuildConfig({ cwd = process.cwd(), projectPath, outDir = defaultOutDir, testMode = false, testPrinterOutput = false, testOutputDevice = "printer", moduleName } = {}) {
  const projectRoot = resolve(cwd, projectPath);
  const sourceFiles = await findProjectMbasFiles(resolve(projectRoot, "source"));
  const testFiles = testMode ? filterProjectTestFiles(await findProjectMbasFiles(resolve(projectRoot, "tests")), moduleName) : [];

  if (sourceFiles.length === 0) {
    throw new Error(`Project ${projectPath} has no .mbas files in its source folder.`);
  }
  if (testMode && testFiles.length === 0) {
    throw new Error(moduleName ? `Project ${projectPath} has no test file for module "${moduleName}".` : `Project ${projectPath} has no .mbas files in its tests folder.`);
  }

  const configDir = resolve(cwd, outDir, ".projects");
  await mkdir(configDir, { recursive: true });
  const mode = testMode ? `${moduleName ? `${safeProjectPart(moduleName)}.` : ""}tests` : "source";
  const configPath = resolve(configDir, `${basename(projectRoot)}.${mode}.metabasic.json`);
  await writeFile(
    configPath,
    `${JSON.stringify({ testMode, ...(testPrinterOutput ? { testPrinterOutput, testOutputDevice } : {}), files: [...sourceFiles, ...testFiles] }, null, 2)}\n`,
    "utf8"
  );
  return configPath;
}

export function filterProjectTestFiles(testFiles, moduleName) {
  if (!moduleName) {
    return testFiles;
  }

  const normalized = normalizeModuleName(moduleName);
  return testFiles.filter((file) => {
    const name = basename(file, extname(file)).toLowerCase();
    return name === normalized || name === `${normalized}-tests` || name === `${normalized}.test`;
  });
}

function normalizeModuleName(moduleName) {
  return moduleName.trim().toLowerCase();
}

function safeProjectPart(value) {
  return normalizeModuleName(value).replaceAll(/[^a-z0-9_-]/g, "");
}

async function findProjectMbasFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mbas"))
    .map((entry) => resolve(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function replacePlaceholders(value, replacements) {
  return value.replaceAll(/\{([A-Za-z][A-Za-z0-9-]*)\}/g, (match, key) => replacements[key] ?? match);
}

function resolveMaybe(cwd, path) {
  return resolve(cwd, path);
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, { cwd, shell = false }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(signal ? `${command} terminated with signal ${signal}.` : `${command} exited with code ${code}.`));
    });
  });
}

function npmCommand() {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd", "run", "build"] };
  }
  return { command: "npm", args: ["run", "build"] };
}

function relativeToCwd(cwd, path) {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}

function parseArgs(argv) {
  const options = {
    target: undefined,
    profile: "debug",
    allProfiles: false,
    source: defaultSource,
    buildConfigPath: undefined,
    projectPath: undefined,
    testMode: false,
    testPrinterOutput: false,
    testOutputDevice: "printer",
    moduleName: undefined,
    outDir: defaultOutDir,
    configPath: defaultToolConfig,
    runBuild: true,
    runTools: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--profile") {
      options.profile = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--all-profiles") {
      options.allProfiles = true;
      continue;
    }
    if (arg === "--source") {
      options.source = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--build-config") {
      options.buildConfigPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--project") {
      options.projectPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--run-tests") {
      options.testMode = true;
      continue;
    }
    if (arg === "--printer-output") {
      options.testPrinterOutput = true;
      continue;
    }
    if (arg === "--test-output-device") {
      options.testOutputDevice = parseDeviceKind(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--module") {
      options.moduleName = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.configPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--skip-build") {
      options.runBuild = false;
      continue;
    }
    if (arg === "--no-tools") {
      options.runTools = false;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    }
    if (options.target) {
      throw new Error(`Unexpected extra argument "${arg}".`);
    }
    options.target = arg;
  }

  if (!options.target) {
    throw new Error(
      "Usage: node scripts/build-target.mjs <spectrum|atari800xl|c64> [--profile debug|balanced|release] [--all-profiles] [--source file.mbas|--build-config metabasic.json|--project folder] [--run-tests] [--printer-output] [--test-output-device printer|rs232] [--module name]"
    );
  }
  const selectedInputs = [options.source !== defaultSource, Boolean(options.buildConfigPath), Boolean(options.projectPath)].filter(Boolean).length;
  if (selectedInputs > 1) {
    throw new Error("Specify only one of --source, --build-config, or --project.");
  }
  if (options.moduleName && (!options.projectPath || !options.testMode)) {
    throw new Error("--module can only be used with --project and --run-tests.");
  }
  if (options.testPrinterOutput && !options.testMode) {
    throw new Error("--printer-output can only be used with --run-tests.");
  }

  return options;
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseDeviceKind(value) {
  const normalized = value.toLowerCase();
  if (normalized === "printer" || normalized === "rs232") {
    return normalized;
  }
  throw new Error(`Invalid --test-output-device value "${value}". Expected printer or rs232.`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.allProfiles) {
      await buildProject();
      for (const profile of Object.keys(profiles)) {
        await buildTarget({ ...options, profile, runBuild: false });
      }
    } else {
      await buildTarget(options);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
