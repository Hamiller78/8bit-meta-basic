import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("VS Code extension packaging", () => {
  it("includes shared script modules without bundling local tool configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "mbas-extension-"));
    try {
      await mkdir(join(root, "scripts", "lib"), { recursive: true });
      await mkdir(join(root, "dist"), { recursive: true });
      await mkdir(join(root, "vscode-extension"), { recursive: true });
      await copyFile(resolve("scripts/package-vscode-extension.mjs"), join(root, "scripts", "package-vscode-extension.mjs"));
      await writeFile(join(root, "scripts", "build-all.mjs"), 'import "./lib/build-target.mjs";\n');
      await writeFile(join(root, "scripts", "lib", "build-target.mjs"), 'export const ready = true;\n');
      await writeFile(join(root, "scripts", "tools.local.json"), '{"private":true}');
      await writeFile(join(root, "dist", "cli.js"), "export {};\n");
      execFileSync(process.execPath, [join(root, "scripts", "package-vscode-extension.mjs")]);
      expect(await readFile(join(root, "vscode-extension", "tools", "scripts", "lib", "build-target.mjs"), "utf8")).toContain("ready");
      await expect(readFile(join(root, "vscode-extension", "tools", "scripts", "tools.local.json"), "utf8")).rejects.toThrow();
      execFileSync(process.execPath, [join(root, "vscode-extension", "tools", "scripts", "build-all.mjs")]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
