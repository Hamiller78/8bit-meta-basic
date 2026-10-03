import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const launcherScripts = {
  fuse: "scripts/launch-spectrum.mjs",
  altirra: "scripts/launch-atari.mjs",
  atari800: "scripts/launch-atari800.mjs",
  vice: "scripts/launch-c64.mjs"
};

export async function loadToolConfiguration(cwd, configPath) {
  const absolutePath = resolve(cwd, configPath);
  try {
    await access(absolutePath, constants.F_OK);
  } catch {
    return undefined;
  }
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

export function compilerTargetConfiguration(config, compilerTarget) {
  return config?.targets?.[compilerTarget];
}

export function namedTargetConfigurations(config) {
  return config?.targetConfigurations ?? {};
}

export function resolveTargetConfiguration(config, name, expected = {}) {
  const targetConfiguration = namedTargetConfigurations(config)[name];
  if (!targetConfiguration) {
    const available = Object.keys(namedTargetConfigurations(config));
    const suffix = available.length > 0 ? ` Available configurations: ${available.join(", ")}.` : "";
    throw new Error(`Unknown target configuration "${name}".${suffix}`);
  }
  if (!targetConfiguration.compilerTarget) {
    throw new Error(`Target configuration "${name}" has no compilerTarget.`);
  }
  if (!targetConfiguration.emulator?.type) {
    throw new Error(`Target configuration "${name}" has no emulator.type.`);
  }
  if (expected.compilerTarget && targetConfiguration.compilerTarget !== expected.compilerTarget) {
    throw new Error(
      `Target configuration "${name}" uses compiler target "${targetConfiguration.compilerTarget}", not "${expected.compilerTarget}".`
    );
  }
  if (expected.emulatorType && targetConfiguration.emulator.type !== expected.emulatorType) {
    throw new Error(
      `Target configuration "${name}" uses emulator type "${targetConfiguration.emulator.type}", not "${expected.emulatorType}".`
    );
  }
  return targetConfiguration;
}

export function launcherScriptFor(targetConfiguration) {
  const script = launcherScripts[targetConfiguration?.emulator?.type];
  if (!script) {
    throw new Error(
      `Unsupported emulator type "${targetConfiguration?.emulator?.type ?? ""}". Expected one of: ${Object.keys(launcherScripts).join(", ")}.`
    );
  }
  return script;
}
