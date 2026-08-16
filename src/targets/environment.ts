import type { TargetId } from "./target.js";

export type PortableColor = "BLACK" | "BLUE" | "RED" | "MAGENTA" | "GREEN" | "CYAN" | "YELLOW" | "WHITE";

export interface ColorValue {
  readonly kind: "color";
  readonly color: PortableColor;
}

export type EnvironmentConstantValue = number | ColorValue;

export interface TargetEnvironment {
  readonly textRows: number;
  readonly textColumns: number;
  readonly constants: ReadonlyMap<string, EnvironmentConstantValue>;
}

export const portableColors: readonly PortableColor[] = ["BLACK", "BLUE", "RED", "MAGENTA", "GREEN", "CYAN", "YELLOW", "WHITE"];

export const targetEnvironments: Readonly<Record<TargetId, TargetEnvironment>> = {
  spectrum: buildEnvironment(22, 32, 50),
  atari800xl: buildEnvironment(24, 40, 50),
  c64: buildEnvironment(25, 40, 50)
};

function buildEnvironment(textRows: number, textColumns: number, jiffiesPerSecond: number): TargetEnvironment {
  const constants = new Map<string, EnvironmentConstantValue>([
    ["text_rows", textRows],
    ["text_columns", textColumns],
    ["jiffies_per_second", jiffiesPerSecond]
  ]);

  for (const color of portableColors) {
    constants.set(color.toLowerCase(), { kind: "color", color });
  }

  return { textRows, textColumns, constants };
}
