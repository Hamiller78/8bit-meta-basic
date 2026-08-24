const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { createMetaBasicDiagnostics } = require("./diagnostics");

const output = vscode.window.createOutputChannel("MetaBASIC");
const diagnostics = createMetaBasicDiagnostics(output);

const targetChoices = [
  { label: "ZX Spectrum", value: "spectrum", launchScript: "launch:spectrum" },
  { label: "Atari 800XL", value: "atari800xl", launchScript: "launch:atari" },
  { label: "Commodore 64", value: "c64", launchScript: "launch:c64" }
];

function activate(context) {
  context.subscriptions.push(output);
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.buildProject", () => runProjectCommand(context, { action: "Build Project", script: "build:all-targets", skipExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.buildTarget", () => buildTarget(context, { skipExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.deployProject", () => runProjectCommand(context, { action: "Deploy Project", script: "build:all-targets", forceExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.deployTarget", () => buildTarget(context, { action: "Deploy", forceExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.buildTests", () => runProjectCommand(context, { action: "Build Tests", script: "build:all-targets", testMode: true, skipExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.launchProject", () => runProjectCommand(context, { action: "Launch Project", script: "launch:all-targets", launch: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.launchTarget", () => launchTarget(context)));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.launchTests", () => runProjectCommand(context, { action: "Launch Tests", script: "launch:all-targets", launch: true, testMode: true })));
}

function deactivate() {}

async function buildTarget(context, options = {}) {
  const target = await pickTarget();
  if (!target) {
    return;
  }
  await runProjectCommand(context, {
    action: `${options.action ?? "Build"} ${target.label}`,
    script: "build:target",
    target: target.value,
    skipExternalTools: options.skipExternalTools,
    forceExternalTools: options.forceExternalTools
  });
}

async function launchTarget(context) {
  const target = await pickTarget();
  if (!target) {
    return;
  }
  await runProjectCommand(context, { action: `Launch ${target.label}`, script: target.launchScript, launch: true });
}

async function pickTarget() {
  return vscode.window.showQuickPick(targetChoices, {
    placeHolder: "Select a MetaBASIC target"
  });
}

async function runProjectCommand(context, options) {
  const workspaceFolder = pickWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("Open a MetaBASIC project folder before running MetaBASIC commands.");
    return;
  }

  const toolRoot = resolveToolRoot(context);
  if (!fs.existsSync(path.join(toolRoot, "scripts", "build-all.mjs"))) {
    vscode.window.showErrorMessage(`MetaBASIC tools were not found at ${toolRoot}. Set metabasic.toolRoot to your tool checkout.`);
    return;
  }

  const config = vscode.workspace.getConfiguration("metabasic", workspaceFolder.uri);
  const profile = config.get("profile", "debug");
  const args = npmScriptArgs(options, workspaceFolder.uri.fsPath, config, profile);

  output.clear();
  output.show(true);
  output.appendLine(`MetaBASIC: ${options.action} (${workspaceFolder.name}, ${profile})`);
  output.appendLine(`Project: ${workspaceFolder.uri.fsPath}`);
  output.appendLine(`Tools: ${toolRoot}`);
  output.appendLine("");
  diagnostics.clearWorkspace(workspaceFolder);

  try {
    const npm = npmInvocation(args);
    await run(npm.command, npm.args, toolRoot);
    vscode.window.showInformationMessage(`MetaBASIC ${options.action.toLowerCase()} finished for ${workspaceFolder.name}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const foundDiagnostics = diagnostics.updateFromTranscript(workspaceFolder, getTranscript(error));
    if (foundDiagnostics > 0) {
      output.appendLine("");
      output.appendLine(`Found ${foundDiagnostics} diagnostic${foundDiagnostics === 1 ? "" : "s"}. See the Problems panel.`);
    }
    vscode.window.showErrorMessage(`MetaBASIC ${options.action.toLowerCase()} failed: ${message}`);
  }
}

function npmScriptArgs(options, projectPath, config, profile) {
  const args = ["run", options.script, "--"];
  if (options.target) {
    args.push(options.target);
  }
  args.push("--project", projectPath, "--profile", profile, "--out-dir", path.join(projectPath, "build"));

  if (options.testMode) {
    args.push("--run-tests");
    if (config.get("mirrorTestOutput", false)) {
      args.push("--printer-output", "--test-output-device", config.get("testOutputDevice", "printer"));
    }
  }

  if (options.launch && config.get("restartEmulators", true)) {
    args.push("--restart");
  }

  if (!options.launch && !options.forceExternalTools && (options.skipExternalTools || !config.get("runExternalTools", true))) {
    args.push("--no-tools");
  }

  return args;
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
    let transcript = "";
    output.appendLine(`> ${formatCommand(command, args)}`);
    const child = cp.spawn(command, args, { cwd, shell: false });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      transcript += text;
      output.append(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      transcript += text;
      output.append(text);
    });
    child.on("error", (error) => {
      error.transcript = transcript;
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve(transcript);
        return;
      }
      const error = new Error(signal ? `${command} terminated with signal ${signal}` : `${command} exited with code ${code}`);
      error.transcript = transcript;
      reject(error);
    });
  });
}

function getTranscript(error) {
  if (error && typeof error === "object" && typeof error.transcript === "string") {
    return error.transcript;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ");
}

function npmInvocation(args) {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...args]
    };
  }
  return { command: "npm", args };
}

module.exports = {
  activate,
  deactivate
};
