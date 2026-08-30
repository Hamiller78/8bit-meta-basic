const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { createMetaBasicDiagnostics } = require("./diagnostics");

const output = vscode.window.createOutputChannel("MetaBASIC");
const diagnostics = createMetaBasicDiagnostics(output);

const targetChoices = [
  { label: "ZX Spectrum", value: "spectrum", launchScript: "scripts/launch-spectrum.mjs" },
  { label: "Atari 800XL", value: "atari800xl", launchScript: "scripts/launch-atari.mjs" },
  { label: "Commodore 64", value: "c64", launchScript: "scripts/launch-c64.mjs" }
];

function activate(context) {
  context.subscriptions.push(output);
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.buildProject", () => runProjectCommand(context, { action: "Build Project", script: "scripts/build-all.mjs", skipExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.buildTarget", () => buildTarget(context, { skipExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.deployProject", () => runProjectCommand(context, { action: "Deploy Project", script: "scripts/build-all.mjs", forceExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.deployTarget", () => buildTarget(context, { action: "Deploy", forceExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.buildTests", () => runProjectCommand(context, { action: "Build Tests", script: "scripts/build-all.mjs", testMode: true, skipExternalTools: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.launchProject", () => runProjectCommand(context, { action: "Launch Project", script: "scripts/launch-all-targets.mjs", launch: true })));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.launchTarget", () => launchTarget(context)));
  context.subscriptions.push(vscode.commands.registerCommand("metabasic.launchTests", () => runProjectCommand(context, { action: "Launch Tests", script: "scripts/launch-all-targets.mjs", launch: true, testMode: true })));
}

function deactivate() {}

async function buildTarget(context, options = {}) {
  const target = await pickTarget();
  if (!target) {
    return;
  }
  await runProjectCommand(context, {
    action: `${options.action ?? "Build"} ${target.label}`,
    script: "scripts/build-target.mjs",
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
  if (!fs.existsSync(path.join(toolRoot, "scripts", "build-all.mjs")) || !fs.existsSync(path.join(toolRoot, "dist", "cli.js"))) {
    vscode.window.showErrorMessage(`MetaBASIC tools were not found at ${toolRoot}. Reinstall the extension or set metabasic.toolRoot to a tool checkout.`);
    return;
  }

  const config = vscode.workspace.getConfiguration("metabasic", workspaceFolder.uri);
  const profile = config.get("profile", "debug");
  const invocation = toolInvocation(options, workspaceFolder.uri.fsPath, config, profile, toolRoot);

  output.clear();
  output.show(true);
  output.appendLine(`MetaBASIC: ${options.action} (${workspaceFolder.name}, ${profile})`);
  output.appendLine(`Project: ${workspaceFolder.uri.fsPath}`);
  output.appendLine(`Tools: ${toolRoot}`);
  if (invocation.toolConfig) {
    output.appendLine(`Tool config: ${invocation.toolConfig}`);
  }
  output.appendLine("");
  diagnostics.clearWorkspace(workspaceFolder);

  try {
    await run(invocation.command, invocation.args, toolRoot, invocation.env);
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

function toolInvocation(options, projectPath, config, profile, toolRoot) {
  const script = launchScriptForOptions(options, config);
  const args = [path.join(toolRoot, script)];
  if (options.target) {
    args.push(options.target);
  }
  args.push("--project", projectPath, "--profile", profile, "--out-dir", path.join(projectPath, "build"));
  args.push("--skip-build");
  const toolConfig = resolveToolConfig(projectPath, config);
  if (toolConfig) {
    args.push("--config", toolConfig);
  } else if (options.launch || options.forceExternalTools) {
    args.push("--config", path.join(projectPath, "metabasic-tools.json"));
  }

  if (options.testMode) {
    args.push("--run-tests");
    if (config.get("mirrorTestOutput", false)) {
      args.push("--printer-output");
      const testOutputDevice = config.get("testOutputDevice", "target-default");
      if (testOutputDevice !== "target-default") {
        args.push("--test-output-device", testOutputDevice);
      }
    }
  }

  if (options.launch && script === "scripts/launch-all-targets.mjs") {
    args.push("--atari-emulator", config.get("atariEmulator", "auto"));
  }

  if (options.launch && config.get("restartEmulators", true)) {
    args.push("--restart");
  }

  if (!options.launch && !options.forceExternalTools && (options.skipExternalTools || !config.get("runExternalTools", true))) {
    args.push("--no-tools");
  }

  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" }, toolConfig: toolConfig ?? (options.launch || options.forceExternalTools ? path.join(projectPath, "metabasic-tools.json") : undefined) };
}

function launchScriptForOptions(options, config) {
  if (options.launch && options.target === "atari800xl" && config.get("atariEmulator", "auto") === "atari800") {
    return "scripts/launch-atari800.mjs";
  }
  return options.script;
}

function resolveToolConfig(projectPath, config) {
  const configured = config.get("toolConfig", "").trim();
  if (configured.length > 0) {
    return path.isAbsolute(configured) ? configured : path.join(projectPath, configured);
  }

  const projectConfig = path.join(projectPath, "metabasic-tools.json");
  if (fs.existsSync(projectConfig)) {
    return projectConfig;
  }

  const legacyProjectConfig = path.join(projectPath, "tools.local.json");
  return fs.existsSync(legacyProjectConfig) ? legacyProjectConfig : undefined;
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
  const bundled = path.join(context.extensionPath, "tools");
  if (fs.existsSync(path.join(bundled, "scripts", "build-all.mjs"))) {
    return bundled;
  }
  return path.resolve(context.extensionPath, "..");
}

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    let transcript = "";
    output.appendLine(`> ${formatCommand(command, args)}`);
    const child = cp.spawn(command, args, { cwd, shell: false, env: { ...process.env, ...extraEnv } });

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

module.exports = {
  activate,
  deactivate
};
