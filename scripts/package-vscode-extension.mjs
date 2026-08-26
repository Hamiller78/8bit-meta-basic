#!/usr/bin/env node
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = join(root, "vscode-extension");
const toolsRoot = join(extensionRoot, "tools");

async function main() {
  await rm(toolsRoot, { recursive: true, force: true });
  await mkdir(join(toolsRoot, "dist"), { recursive: true });
  await mkdir(join(toolsRoot, "scripts"), { recursive: true });

  await copyDirectory(join(root, "dist"), join(toolsRoot, "dist"), (name) => name.endsWith(".js"));
  await copyDirectoryFiles(join(root, "scripts"), join(toolsRoot, "scripts"), (name) => name.endsWith(".mjs") || name === "tools.example.json");
  await writeFile(join(toolsRoot, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
  console.log(`prepared ${relative(toolsRoot)}`);
}

async function copyDirectory(sourceDir, targetDir, include) {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, include);
      continue;
    }
    if (entry.isFile() && include(entry.name)) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function copyDirectoryFiles(sourceDir, targetDir, include) {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !include(entry.name)) {
      continue;
    }
    await copyFile(join(sourceDir, entry.name), join(targetDir, entry.name));
  }
}

function relative(path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : basename(path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
