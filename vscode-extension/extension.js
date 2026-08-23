const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const output = vscode.window.createOutputChannel("MetaBASIC");

function activate(context) {
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.buildProject", () => buildProject(context)));
}

function deactivate() {}

async function buildProject(context) {
  const workspaceFolder = pickWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("Open a MetaBASIC project folder before building.");
    return;
  }

  const toolRoot = resolveToolRoot(context);
  if (!fs.existsSync(path.join(toolRoot, "scripts", "build-all.mjs"))) {
    vscode.window.showErrorMessage(`MetaBASIC tools were not found at ${toolRoot}. Set metabasic.toolRoot to your tool checkout.`);
    return;
  }

  const config = vscode.workspace.getConfiguration("metabasic", workspaceFolder.uri);
  const profile = config.get("profile", "debug");
  const runExternalTools = config.get("runExternalTools", true);
  const args = ["run", "build:all-targets", "--", "--project", workspaceFolder.uri.fsPath, "--profile", profile];
  if (!runExternalTools) {
    args.push("--no-tools");
  }

  output.clear();
  output.show(true);
  output.appendLine(`MetaBASIC: building ${workspaceFolder.name} (${profile})`);
  output.appendLine(`Tools: ${toolRoot}`);
  output.appendLine("");

  try {
    await run(npmCommand(), args, toolRoot);
    vscode.window.showInformationMessage(`MetaBASIC build finished for ${workspaceFolder.name}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`MetaBASIC build failed: ${message}`);
  }
}

function pickWorkspaceFolder() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

function resolveToolRoot(context) {
  const configured = vscode.workspace.getConfiguration("metabasic").get("toolRoot", "").trim();
  if (configured.length > 0) {
    return configured;
  }
  return path.resolve(context.extensionPath, "..");
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    output.appendLine(`> ${command} ${args.join(" ")}`);
    const child = cp.spawn(command, args, { cwd, shell: false });

    child.stdout.on("data", (chunk) => output.append(chunk.toString()));
    child.stderr.on("data", (chunk) => output.append(chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `${command} terminated with signal ${signal}` : `${command} exited with code ${code}`));
    });
  });
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

module.exports = {
  activate,
  deactivate
};
