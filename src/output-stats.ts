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
  readonly variableRoles: VariableRoleStats;
}

export interface VariableRoleStats {
  readonly userVisible: readonly string[];
  readonly functionParameters: readonly string[];
  readonly functionLocals: readonly string[];
  readonly functionReturns: readonly string[];
  readonly compilerTemporaries: readonly string[];
  readonly testLocals: readonly string[];
  readonly testRuntime: readonly string[];
  readonly generatedBookkeeping: readonly string[];
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

  const allVariables = new Set([...numericVariables, ...stringVariables, ...numericArrays, ...stringArrays]);

  return {
    lineCount: lines.length,
    ...(firstLineNumber !== undefined ? { firstLineNumber } : {}),
    ...(lastLineNumber !== undefined ? { lastLineNumber } : {}),
    longestLineLength,
    ...(longestLineNumber !== undefined ? { longestLineNumber } : {}),
    numericVariables: sorted(numericVariables),
    stringVariables: sorted(stringVariables),
    numericArrays: sorted(numericArrays),
    stringArrays: sorted(stringArrays),
    variableRoles: classifyVariableRoles(allVariables)
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
    `    String arrays: ${stats.stringArrays.length}${formatNames(stats.stringArrays)}`,
    "  Variable roles:",
    `    User-visible globals/arrays: ${stats.variableRoles.userVisible.length}${formatNames(stats.variableRoles.userVisible)}`,
    `    FUNCTION parameters: ${stats.variableRoles.functionParameters.length}${formatNames(stats.variableRoles.functionParameters)}`,
    `    FUNCTION locals: ${stats.variableRoles.functionLocals.length}${formatNames(stats.variableRoles.functionLocals)}`,
    `    FUNCTION returns: ${stats.variableRoles.functionReturns.length}${formatNames(stats.variableRoles.functionReturns)}`,
    `    Compiler temporaries: ${stats.variableRoles.compilerTemporaries.length}${formatNames(stats.variableRoles.compilerTemporaries)}`,
    `    TEST locals: ${stats.variableRoles.testLocals.length}${formatNames(stats.variableRoles.testLocals)}`,
    `    TEST runtime: ${stats.variableRoles.testRuntime.length}${formatNames(stats.variableRoles.testRuntime)}`,
    `    Other generated bookkeeping: ${stats.variableRoles.generatedBookkeeping.length}${formatNames(stats.variableRoles.generatedBookkeeping)}`
  ].join("\n");
}

function classifyVariableRoles(names: ReadonlySet<string>): VariableRoleStats {
  const roles = {
    userVisible: new Set<string>(),
    functionParameters: new Set<string>(),
    functionLocals: new Set<string>(),
    functionReturns: new Set<string>(),
    compilerTemporaries: new Set<string>(),
    testLocals: new Set<string>(),
    testRuntime: new Set<string>(),
    generatedBookkeeping: new Set<string>()
  };

  for (const name of names) {
    const base = baseName(name);
    if (/^MBF\d+P\d+$/i.test(base)) {
      roles.functionParameters.add(name);
    } else if (/^MBF\d+L\d+$/i.test(base)) {
      roles.functionLocals.add(name);
    } else if (/^MBF\d+R$/i.test(base)) {
      roles.functionReturns.add(name);
    } else if (/^MBT\d+$/i.test(base)) {
      roles.compilerTemporaries.add(name);
    } else if (/^MBTEST\d+L\d+$/i.test(base)) {
      roles.testLocals.add(name);
    } else if (testRuntimeVariables.has(name) || testRuntimeVariables.has(base)) {
      roles.testRuntime.add(name);
    } else if (/^MB[A-Z0-9]*/i.test(base)) {
      roles.generatedBookkeeping.add(name);
    } else {
      roles.userVisible.add(name);
    }
  }

  return {
    userVisible: sorted(roles.userVisible),
    functionParameters: sorted(roles.functionParameters),
    functionLocals: sorted(roles.functionLocals),
    functionReturns: sorted(roles.functionReturns),
    compilerTemporaries: sorted(roles.compilerTemporaries),
    testLocals: sorted(roles.testLocals),
    testRuntime: sorted(roles.testRuntime),
    generatedBookkeeping: sorted(roles.generatedBookkeeping)
  };
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
  "CLOSE",
  "OPEN",
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
  "ST",
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
  "FRE",
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
  "USR",
  "VAL"
]);

const variableNamePattern = /\b[A-Z][A-Z0-9]*(?:[%$])?(?![A-Z0-9])/gi;

const testRuntimeVariables = new Set([
  "MBTOUT$",
  "MBTPOUT$",
  "MBTPROW",
  "MBTPCOL",
  "MBTCB",
  "MBTCG",
  "MBTCT",
  "MBTCC",
  "MBTCD",
  "MBTESTS",
  "MBTPASS",
  "MBTFAIL",
  "MBASSERT",
  "MBFAIL",
  "MBTF0",
  "MBTF",
  "MBTAOK",
  "MBAVEX",
  "MBAVEX$",
  "MBAVAC",
  "MBAVAC$",
  "MBAVR",
  "MBAVC",
  "MBAVT",
  "MBAVT$",
  "MBAB",
  "MBTPRN",
  "MBTPR",
  "MBTMSG$",
  "MB",
  "MB$"
]);
