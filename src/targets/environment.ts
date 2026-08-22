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

const spectrumKeyCodes = {
  KEY_NONE: 0,
  KEY_UP: 11,
  KEY_DOWN: 10,
  KEY_LEFT: 8,
  KEY_RIGHT: 9,
  GAME_UP: 113,
  GAME_DOWN: 97,
  GAME_LEFT: 111,
  GAME_RIGHT: 112,
  GAME_FIRE: 32,
  KEY_SPACE: 32,
  KEY_ENTER: 13,
  KEY_ESCAPE: -1,
  KEY_F1: 49,
  KEY_F2: 50,
  KEY_F3: 51,
  KEY_F4: 52,
  KEY_F5: 53,
  KEY_F6: 54,
  KEY_F7: 55,
  KEY_F8: 56
} as const;

const atariKeyCodes = {
  KEY_NONE: 255,
  KEY_UP: 142,
  KEY_DOWN: 143,
  KEY_LEFT: 134,
  KEY_RIGHT: 135,
  GAME_UP: 142,
  GAME_DOWN: 143,
  GAME_LEFT: 134,
  GAME_RIGHT: 135,
  GAME_FIRE: 33,
  KEY_SPACE: 33,
  KEY_ENTER: 12,
  KEY_ESCAPE: 28,
  KEY_F1: 3,
  KEY_F2: 4,
  KEY_F3: 19,
  KEY_F4: 20,
  KEY_F5: -1,
  KEY_F6: -1,
  KEY_F7: -1,
  KEY_F8: -1
} as const;

const c64KeyCodes = {
  KEY_NONE: 0,
  KEY_UP: 145,
  KEY_DOWN: 17,
  KEY_LEFT: 157,
  KEY_RIGHT: 29,
  GAME_UP: 145,
  GAME_DOWN: 17,
  GAME_LEFT: 157,
  GAME_RIGHT: 29,
  GAME_FIRE: 32,
  KEY_SPACE: 32,
  KEY_ENTER: 13,
  KEY_ESCAPE: 3,
  KEY_F1: 133,
  KEY_F2: 137,
  KEY_F3: 134,
  KEY_F4: 138,
  KEY_F5: 135,
  KEY_F6: 139,
  KEY_F7: 136,
  KEY_F8: 140
} as const;

const letterKeyCodes = {
  spectrum: alphabetCodes(97),
  c64: alphabetCodes(65),
  atari800xl: {
    A: 63,
    B: 21,
    C: 18,
    D: 58,
    E: 42,
    F: 56,
    G: 61,
    H: 57,
    I: 13,
    J: 1,
    K: 5,
    L: 0,
    M: 37,
    N: 35,
    O: 8,
    P: 10,
    Q: 47,
    R: 40,
    S: 62,
    T: 45,
    U: 11,
    V: 16,
    W: 46,
    X: 22,
    Y: 43,
    Z: 23
  }
} as const;

const digitKeyCodes = {
  spectrum: digitCodes(48),
  c64: digitCodes(48),
  atari800xl: {
    "0": 50,
    "1": 31,
    "2": 30,
    "3": 26,
    "4": 24,
    "5": 29,
    "6": 27,
    "7": 51,
    "8": 53,
    "9": 48
  }
} as const;

export const targetEnvironments: Readonly<Record<TargetId, TargetEnvironment>> = {
  spectrum: buildEnvironment("spectrum", 22, 32, 50, spectrumKeyCodes),
  atari800xl: buildEnvironment("atari800xl", 24, 40, 50, atariKeyCodes),
  c64: buildEnvironment("c64", 25, 40, 50, c64KeyCodes)
};

function buildEnvironment(
  target: TargetId,
  textRows: number,
  textColumns: number,
  jiffiesPerSecond: number,
  keyCodes: Readonly<Record<string, number>>
): TargetEnvironment {
  const constants = new Map<string, EnvironmentConstantValue>([
    ["text_rows", textRows],
    ["text_columns", textColumns],
    ["jiffies_per_second", jiffiesPerSecond],
    ["pi", Math.PI],
    ["e", Math.E]
  ]);

  for (const color of portableColors) {
    constants.set(color.toLowerCase(), { kind: "color", color });
  }

  for (const [name, value] of Object.entries(keyCodes)) {
    constants.set(name.toLowerCase(), value);
  }

  for (const [letter, value] of Object.entries(letterKeyCodes[target])) {
    constants.set(`key_${letter.toLowerCase()}`, value);
  }
  for (const [digit, value] of Object.entries(digitKeyCodes[target])) {
    constants.set(`key_${digit}`, value);
  }

  return { textRows, textColumns, constants };
}

function alphabetCodes(firstCode: number): Readonly<Record<string, number>> {
  return Object.fromEntries(Array.from({ length: 26 }, (_, index) => [String.fromCharCode(65 + index), firstCode + index]));
}

function digitCodes(firstCode: number): Readonly<Record<string, number>> {
  return Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index.toString(), firstCode + index]));
}
