export interface OutputStats {
  readonly lineCount: number;
  readonly firstLineNumber?: number;
  readonly lastLineNumber?: number;
  readonly longestLineLength: number;
  readonly longestLineNumber?: number;
  readonly numericVariables: readonly string[];
  readonly stringVariables: readonly string[];
  readonly numericArrays: readonly string[];
  readonly stringArrays: readonly string[];
}

export function analyzeBasicOutput(lines: readonly string[], target?: string): OutputStats {
  const numericVariables = new Set<string>();
  const stringVariables = new Set<string>();
  const numericArrays = new Set<string>();
  const stringArrays = new Set<string>();
  let firstLineNumber: number | undefined;
  let lastLineNumber: number | undefined;
  let longestLineLength = 0;
  let longestLineNumber: number | undefined;

  for (const line of lines) {
    const lineNumber = parseLineNumber(line);
    if (lineNumber !== undefined) {
      firstLineNumber ??= lineNumber;
      lastLineNumber = lineNumber;
    }

    const length = [...line].length;
    if (length > longestLineLength) {
      longestLineLength = length;
      longestLineNumber = lineNumber;
    }
  }

  for (const line of lines) {
    collectDimmedVariables(line, target, numericVariables, stringVariables, numericArrays, stringArrays);
  }

  for (const line of lines) {
    collectVariables(line, target, numericVariables, stringVariables, numericArrays, stringArrays);
  }

  return {
    lineCount: lines.length,
    ...(firstLineNumber !== undefined ? { firstLineNumber } : {}),
    ...(lastLineNumber !== undefined ? { lastLineNumber } : {}),
    longestLineLength,
    ...(longestLineNumber !== undefined ? { longestLineNumber } : {}),
    numericVariables: sorted(numericVariables),
    stringVariables: sorted(stringVariables),
    numericArrays: sorted(numericArrays),
    stringArrays: sorted(stringArrays)
  };
}

export function formatOutputStats(stats: OutputStats): string {
  const lineRange =
    stats.firstLineNumber !== undefined && stats.lastLineNumber !== undefined ? ` (${stats.firstLineNumber}..${stats.lastLineNumber})` : "";
  const longestLine = stats.longestLineNumber !== undefined ? `${stats.longestLineLength} chars at ${stats.longestLineNumber}` : `${stats.longestLineLength} chars`;
  const totalVariables = stats.numericVariables.length + stats.stringVariables.length + stats.numericArrays.length + stats.stringArrays.length;

  return [
    "Transpiler output:",
    `  BASIC lines: ${stats.lineCount}${lineRange}`,
    `  Longest line: ${longestLine}`,
    `  Variables total: ${totalVariables}`,
    `    Numeric scalars: ${stats.numericVariables.length}${formatNames(stats.numericVariables)}`,
    `    String scalars: ${stats.stringVariables.length}${formatNames(stats.stringVariables)}`,
    `    Numeric arrays: ${stats.numericArrays.length}${formatNames(stats.numericArrays)}`,
    `    String arrays: ${stats.stringArrays.length}${formatNames(stats.stringArrays)}`
  ].join("\n");
}

function collectVariables(
  line: string,
  target: string | undefined,
  numericVariables: Set<string>,
  stringVariables: Set<string>,
  numericArrays: Set<string>,
  stringArrays: Set<string>
): void {
  const code = stripStrings(stripLineNumber(line));
  if (/^\s*REM\b/i.test(code)) {
    return;
  }

  for (const match of code.matchAll(variableNamePattern)) {
    const name = match[0].toUpperCase();
    if (ignoredIdentifiers.has(name) || ignoredCallNames.has(baseName(name))) {
      continue;
    }
    if (isDeclaredArray(name, numericArrays, stringArrays)) {
      continue;
    }
    addName(name, numericVariables, stringVariables);
  }
}

function collectDimmedVariables(
  line: string,
  target: string | undefined,
  numericVariables: Set<string>,
  stringVariables: Set<string>,
  numericArrays: Set<string>,
  stringArrays: Set<string>
): void {
  const code = stripStrings(stripLineNumber(line));
  const dimMatch = /^\s*DIM\s+(.+)$/i.exec(code);
  if (!dimMatch) {
    return;
  }

  for (const match of dimMatch[1].matchAll(variableNamePattern)) {
    const name = match[0].toUpperCase();
    if (target === "atari800xl" && name.endsWith("$")) {
      stringVariables.add(name);
    } else {
      addName(name, numericArrays, stringArrays);
    }
  }
}

function addName(name: string, numericNames: Set<string>, stringNames: Set<string>): void {
  if (name.endsWith("$")) {
    stringNames.add(name);
  } else {
    numericNames.add(name);
  }
}

function isDeclaredArray(name: string, numericArrays: ReadonlySet<string>, stringArrays: ReadonlySet<string>): boolean {
  return numericArrays.has(name) || stringArrays.has(name);
}

function stripLineNumber(line: string): string {
  return line.replace(/^\s*\d+\s*/, "");
}

function stripStrings(line: string): string {
  return line.replaceAll(/"[^"]*"/g, "\"\"");
}

function parseLineNumber(line: string): number | undefined {
  const match = /^\s*(\d+)\b/.exec(line);
  return match ? Number(match[1]) : undefined;
}

function baseName(name: string): string {
  return name.replace(/[%$]$/, "");
}

function sorted(names: ReadonlySet<string>): readonly string[] {
  return [...names].sort((left, right) => left.localeCompare(right));
}

function formatNames(names: readonly string[]): string {
  if (names.length === 0) {
    return "";
  }
  const preview = names.slice(0, 12).join(", ");
  return names.length > 12 ? ` (${preview}, ...)` : ` (${preview})`;
}

const ignoredIdentifiers = new Set([
  "AND",
  "AT",
  "BORDER",
  "CHR",
  "CLS",
  "DATA",
  "DIM",
  "END",
  "FOR",
  "GO",
  "GOSUB",
  "GOTO",
  "IF",
  "LET",
  "NEXT",
  "NOT",
  "OR",
  "PAPER",
  "PEEK",
  "POKE",
  "POSITION",
  "PRINT",
  "RANDOMIZE",
  "READ",
  "REM",
  "RESTORE",
  "RETURN",
  "SETCOLOR",
  "STEP",
  "STOP",
  "SUB",
  "SYS",
  "THEN",
  "TO"
]);

const ignoredCallNames = new Set([
  "ABS",
  "ASC",
  "ATN",
  "CHR",
  "CODE",
  "COS",
  "EXP",
  "INT",
  "LEFT",
  "LEN",
  "MID",
  "PEEK",
  "RND",
  "RIGHT",
  "SGN",
  "SIN",
  "SQR",
  "STR",
  "VAL"
]);

const variableNamePattern = /\b[A-Z][A-Z0-9]*(?:[%$])?(?![A-Z0-9])/gi;
