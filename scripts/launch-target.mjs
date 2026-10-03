#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launcherScriptFor, loadToolConfiguration, resolveTargetConfiguration } from "./target-configurations.mjs";

const defaultToolConfig = "scripts/tools.local.json";

export function parseLaunchTargetArgs(argv) {
  if (argv.length === 0 || argv[0].startsWith("-")) {
    throw new Error("Usage: node scripts/launch-target.mjs <target-configuration> [launch options]");
  }
  const targetConfiguration = argv[0];
  const forwardedArgs = argv.slice(1);
  if (forwardedArgs.includes("--target-configuration")) {
    throw new Error("Select the target configuration with the first positional argument, not --target-configuration.");
  }
  let configPath = defaultToolConfig;
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    if (forwardedArgs[index] === "--config") {
      configPath = forwardedArgs[index + 1] ?? "";
      index += 1;
    }
  }
  if (!configPath) {
    throw new Error("Missing value for --config.");
  }
  return { targetConfiguration, forwardedArgs, configPath };
}

export async function launchNamedTarget(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseLaunchTargetArgs(argv);
  const config = await loadToolConfiguration(cwd, parsed.configPath);
  const targetConfiguration = resolveTargetConfiguration(config, parsed.targetConfiguration);
  const script = launcherScriptFor(targetConfiguration);
  await runLaunch(script, ["--target-configuration", parsed.targetConfiguration, ...parsed.forwardedArgs], cwd);
}

function runLaunch(script, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(cwd, script), ...args], { cwd, stdio: "inherit", windowsHide: false });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${script} exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await launchNamedTarget(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
