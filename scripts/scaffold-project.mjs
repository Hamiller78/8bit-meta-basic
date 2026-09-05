#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function createProject({ cwd = process.cwd(), projectPath }) {
  if (!projectPath) {
    throw new Error("Missing project path.");
  }

  const root = resolve(cwd, projectPath);
  const projectName = basename(root);
  await mkdir(resolve(root, "source"), { recursive: true });
  await mkdir(resolve(root, "tests"), { recursive: true });
  await writeNewFile(resolve(root, "source", "main.mbas"), mainSource(projectName));
  await writeNewFile(resolve(root, "tests", "main-tests.mbas"), mainTestSource());
  await writeNewFile(resolve(root, "metabasic.json"), `${JSON.stringify({ files: ["source/main.mbas"] }, null, 2)}\n`);

  console.log(`created project ${projectPath}`);
}

export async function addModule({ cwd = process.cwd(), projectPath, moduleName }) {
  if (!projectPath) {
    throw new Error("Missing --project value.");
  }
  if (!moduleName) {
    throw new Error("Missing --module value.");
  }

  const normalized = normalizeModuleName(moduleName);
  const root = resolve(cwd, projectPath);
  await mkdir(resolve(root, "source"), { recursive: true });
  await mkdir(resolve(root, "tests"), { recursive: true });
  await writeNewFile(resolve(root, "source", `${normalized}.mbas`), moduleSource(normalized));
  await writeNewFile(resolve(root, "tests", `${normalized}-tests.mbas`), moduleTestSource(normalized));

  console.log(`added module ${normalized} to ${projectPath}`);
}

async function writeNewFile(path, contents) {
  try {
    await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${path}`);
    }
    throw error;
  }
}

function mainSource(projectName) {
  const title = projectName.toUpperCase().replaceAll(/[^A-Z0-9 _-]/g, "");
  return [`print "${title || "META-BASIC PROJECT"}"`, `print "READY"`, ""].join("\n");
}

function mainTestSource() {
  return [`test ProjectStarts()`, `    assert_true 1`, `end test`, ""].join("\n");
}

function moduleSource(moduleName) {
  const functionName = exampleFunctionName(moduleName);
  return [`function ${functionName}(Value)`, `    return Value * 2`, `end function`, ""].join("\n");
}

function moduleTestSource(moduleName) {
  const functionName = exampleFunctionName(moduleName);
  return [`uses "../source/${moduleName}.mbas"`, "", `test ${functionName}Works()`, `    assert_eq 8, ${functionName}(4)`, `end test`, ""].join("\n");
}

function exampleFunctionName(moduleName) {
  return `${pascalCase(moduleName)}Double`;
}

function normalizeModuleName(moduleName) {
  const normalized = moduleName.trim().toLowerCase().replaceAll(/[^a-z0-9_-]/g, "-").replaceAll(/-+/g, "-").replaceAll(/^-|-$/g, "");
  if (!normalized) {
    throw new Error(`Invalid module name "${moduleName}".`);
  }
  return normalized;
}

function pascalCase(value) {
  const words = value.split(/[^a-z0-9]+/).filter(Boolean);
  const name = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("");
  return name || "Module";
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    projectPath: undefined,
    moduleName: undefined
  };

  if (command === "new-project") {
    const [projectPath, extra] = rest;
    if (!projectPath || extra) {
      throw new Error("Usage: node scripts/scaffold-project.mjs new-project <project-folder>");
    }
    options.projectPath = projectPath;
    return options;
  }

  if (command === "new-module") {
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === "--project") {
        options.projectPath = readValue(rest, index, arg);
        index += 1;
        continue;
      }
      if (arg === "--module") {
        options.moduleName = readValue(rest, index, arg);
        index += 1;
        continue;
      }
      throw new Error(`Unknown option "${arg}".`);
    }
    return options;
  }

  throw new Error("Usage: node scripts/scaffold-project.mjs new-project <project-folder> | new-module --project <project-folder> --module <name>");
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "new-project") {
      await createProject({ projectPath: options.projectPath });
    } else {
      await addModule({ projectPath: options.projectPath, moduleName: options.moduleName });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
