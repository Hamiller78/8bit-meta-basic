import type { Expression } from "../ast.js";
import { DiagnosticError } from "../diagnostics.js";
import { builtinFunctions } from "../functions.js";
import { joystickControl } from "../joystick.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { isIntegerVariableName, isStringVariableName } from "../variables.js";
import { lowerByteStorage } from "./byte-storage.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { instructionExpressions, mapInstructionExpressions } from "./instruction-expressions.js";
import { allocateGeneratedVariableName, createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import {
  agonColorCodes,
  expandPositionedPrints,
  expandSetColumns,
  expandSetPositions,
  groupInvertedPrints,
  rebuildLabels,
  renderDataValues,
  renderExpression,
  renderInlineInstructionBodies,
  renderPrintItems,
  type ExpressionRenderOptions,
  type TargetBackend
} from "./target.js";
import { lowerSequentialFileIo } from "./file-io.js";

/** BBC BASIC ADL 1.03: the BBC BASIC 3/4-compatible Z80 interpreter converted to 24-bit ADL mode. */
export const agonTarget: TargetBackend = {
  id: "agon",
  gotoSpelling: "GOTO",
  maxLineLength: 251,
  maxLineNumber: 65279,
  variableMap: buildAgonVariableMap,
  lower(program: LoweredProgram, _readability: ReadabilityLevel): LoweredProgram {
    const firstLocation = program.instructions[0]?.location ?? { filename: "<generated>", line: 1 };
    const groupedInverse = groupInvertedPrints(lowerSequentialFileIo(program));
    const withMode = rebuildLabels(groupedInverse, [
      { kind: "graphics-mode", mode: 3, location: firstLocation },
      ...groupedInverse.instructions
    ]);
    const bytes = lowerByteStorage(withMode, "agon");
    const positions = expandSetPositions(bytes, "Agon Light", 29, 79, (instruction) => [
      { kind: "position", row: instruction.row, column: instruction.column, location: instruction.location }
    ]);
    const columns = expandSetColumns(positions, "Agon Light", 79, (instruction) => [instruction]);
    const prints = expandPositionedPrints(columns, "Agon Light", 29, 79, (instruction) => [instruction]);
    const safeLoops = lowerAgonForExits(prints);
    const strings = validateAgonInternationalStrings(safeLoops);
    const screenReads = lowerAgonScreenReads(strings);
    const inverseText = lowerAgonInverseText(screenReads);
    const randomSeedName = allocateGeneratedVariableName(inverseText.instructions, "MBRND");
    const deviceTextBufferName = allocateGeneratedVariableName(inverseText.instructions, "MBOUTPUT", "$");
    const deviceTextIndexName = allocateGeneratedVariableName(inverseText.instructions, "MBOUTPUTINDEX", "%");
    const instructions: Instruction[] = [];
    for (const instruction of inverseText.instructions) {
      if (instruction.kind === "suppress-scroll-prompt") {
        continue;
      } else if (instruction.kind === "border-color") {
        instructions.push({ kind: "screen-background-color", color: instruction.color, location: instruction.location });
      } else if (instruction.kind === "cls" && instruction.color) {
        instructions.push({ kind: "screen-background-color", color: instruction.color, location: instruction.location });
        instructions.push({ ...instruction, color: undefined });
      } else if (instruction.kind === "on-goto" || instruction.kind === "on-gosub") {
        instructions.push(...lowerSafeDispatch(instruction));
      } else if (instruction.kind === "randomize") {
        const seed: Expression = instruction.seed ?? {
          kind: "function-call",
          name: builtinFunctions.jiffies,
          args: [],
          valueType: "number",
          location: instruction.location
        };
        instructions.push({
          kind: "let",
          name: randomSeedName,
          expression: {
            kind: "function-call",
            name: builtinFunctions.rnd,
            args: [{ kind: "unary", operator: "-", operand: seed, location: instruction.location }],
            valueType: "number",
            location: instruction.location
          },
          location: instruction.location
        });
      } else if (instruction.kind === "print-device") {
        instructions.push({ ...instruction, textBufferName: deviceTextBufferName, textIndexName: deviceTextIndexName });
      } else {
        instructions.push(instruction);
      }
    }
    return rebuildLabels(inverseText, instructions);
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, readability: ReadabilityLevel): string {
    const variableMap = buildAgonVariableMap(currentProgramInstructions, readability);
    const renderOptions = { variableMap, functionRenderer: renderAgonFunction, arrayRenderer: renderAgonArrayAccess };
    switch (instruction.kind) {
      case "label":
        return `${lineNumber} REM ${instruction.name.toUpperCase()}:`;
      case "rem":
        return `${lineNumber} REM ${instruction.text}`;
      case "cls":
        return `${lineNumber} CLS`;
      case "border-color":
        throw new Error("Internal error: unexpected border-color instruction for Agon Light.");
      case "text-color":
      case "cell-text-color":
        return `${lineNumber} COLOUR ${agonColorCodes[instruction.color.color]}`;
      case "screen-background-color":
      case "cell-background-color":
      case "paper":
        return `${lineNumber} COLOUR ${128 + agonColorCodes[instruction.color.color]}`;
      case "suppress-scroll-prompt":
        throw new Error("Internal error: unexpected suppress-scroll-prompt instruction for Agon Light.");
      case "program-mode":
        return `${lineNumber} VDU 23,1,0;0;0;0;`;
      case "print": {
        const at = instruction.at
          ? `TAB(${renderExpression(instruction.at.column, renderOptions)},${renderExpression(instruction.at.row, renderOptions)});`
          : "";
        return `${lineNumber} PRINT ${at}${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      }
      case "inverse-text":
        throw new Error("Internal error: unexpected inverse-text instruction for Agon Light.");
      case "set-column":
        return `${lineNumber} PRINT TAB(${renderExpression(instruction.column, renderOptions)},VPOS);`;
      case "set-position":
        throw new Error("Internal error: unexpected set-position instruction for Agon Light.");
      case "open-device":
        return `${lineNumber} ${deviceHandleName(instruction.handle)}=OPENOUT("${deviceFileName(instruction.device)}")`;
      case "print-device":
        return `${lineNumber} ${renderAgonDeviceOutput(instruction, renderOptions)}`;
      case "close-device":
        return `${lineNumber} CLOSE#${deviceHandleName(instruction.handle)}`;
      case "check-device":
        return `${lineNumber} ${renderVariableName(instruction.name, variableMap)}=1`;
      case "data":
        return `${lineNumber} DATA ${renderDataValues(instruction.values, renderOptions)}`;
      case "read":
        return `${lineNumber} READ ${instruction.targets.map((target) => renderVariableName(target, variableMap)).join(",")}`;
      case "input":
        return `${lineNumber} INPUT ${instruction.targets.map((target) => renderVariableName(target, variableMap)).join(",")}`;
      case "open-data-file":
        return `${lineNumber} MBFILE%=${instruction.mode === "read" ? "OPENIN" : "OPENOUT"}("${instruction.filename}.DAT")`;
      case "write-data-file":
        return `${lineNumber} PRINT#MBFILE%,${renderExpression(instruction.expression, renderOptions)}`;
      case "read-data-file":
        return `${lineNumber} INPUT#MBFILE%,${renderExpression(instruction.target, renderOptions)}`;
      case "close-data-file":
        return `${lineNumber} CLOSE#MBFILE%`;
      case "delete-data-file":
        return `${lineNumber} *DELETE ${instruction.filename}.DAT`;
      case "save-file": case "load-file": case "delete-file": case "save-native-array": case "load-native-array":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Agon Light.`);
      case "restore":
        return `${lineNumber} RESTORE`;
      case "let":
        return `${lineNumber} ${renderVariableName(instruction.name, variableMap)}=${renderExpression(instruction.expression, renderOptions)}`;
      case "multi-let":
        return `${lineNumber} ${instruction.assignments.map((assignment) => `${renderVariableName(assignment.name, variableMap)}=${renderExpression(assignment.expression, renderOptions)}`).join(":")}`;
      case "dim-array":
        return `${lineNumber} DIM ${renderVariableName(instruction.name, variableMap)}(${agonArrayDimensions(instruction.name, instruction.dimensions).join(",")})`;
      case "array-let":
        return `${lineNumber} ${renderAgonArrayAccess({ kind: "array-access", name: instruction.name, indices: instruction.indices, location: instruction.location }, renderOptions)}=${renderExpression(instruction.expression, renderOptions)}`;
      case "goto":
        return `${lineNumber} GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "gosub":
        return `${lineNumber} GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "return":
        return `${lineNumber} RETURN`;
      case "end":
        return `${lineNumber} END`;
      case "for":
        return `${lineNumber} FOR ${renderVariableName(instruction.variable, variableMap)}=${renderExpression(instruction.start, renderOptions)} TO ${renderExpression(instruction.limit, renderOptions)}${instruction.step ? ` STEP ${renderExpression(instruction.step, renderOptions)}` : ""}`;
      case "next":
        return `${lineNumber} NEXT ${renderVariableName(instruction.variable, variableMap)}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "if-gosub":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "if-then":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN ${renderInlineInstructionBodies(agonTarget, lineNumber, instruction.body, labelLines, readability)}`;
      case "on-goto":
      case "on-gosub":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Agon Light.`);
      case "randomize":
        throw new Error("Internal error: unexpected randomize instruction for Agon Light.");
      case "vdu":
        return `${lineNumber} VDU ${instruction.items.map((item, index) =>
          `${renderExpression(item.expression, renderOptions)}${item.word ? ";" : index < instruction.items.length - 1 ? "," : ""}`
        ).join("")}`;
      case "position":
        return `${lineNumber} PRINT TAB(${renderExpression(instruction.column, renderOptions)},${renderExpression(instruction.row, renderOptions)});`;
      case "read-key":
        return `${lineNumber} ${renderVariableName(instruction.name, variableMap)}=INKEY$(0)`;
      case "dim-string":
        return `${lineNumber} REM BBC BASIC STRINGS NEED NO DIMENSION`;
      case "graphics-mode":
        return `${lineNumber} MODE ${instruction.mode}`;
      case "setcolor":
      case "poke":
      case "print-chr":
      case "trap":
      case "wait-rs232-transmit":
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Agon Light.`);
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setAgonRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

interface AgonUnsafeForContext {
  readonly forIndex: number;
  readonly nextIndex: number;
  readonly loopLabel: string;
  readonly variable: string;
  readonly start: Expression;
  readonly limit: Expression;
  readonly step: Expression;
  readonly limitName: string;
  readonly stepName: string;
}

function lowerAgonForExits(program: LoweredProgram): LoweredProgram {
  const instructions = program.instructions;
  const usedLabels = new Set(instructions.filter((instruction) => instruction.kind === "label").map((instruction) => instruction.name));
  const allocateLimitName = createGeneratedVariableNameAllocator(instructions, "MBFORLIMIT");
  const allocateStepName = createGeneratedVariableNameAllocator(instructions, "MBFORSTEP");
  const stack: Array<{ readonly index: number; readonly instruction: Extract<Instruction, { kind: "for" }> }> = [];
  const contexts: AgonUnsafeForContext[] = [];
  let loopLabelSerial = 1;

  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction.kind === "for") {
      stack.push({ index, instruction });
      continue;
    }
    if (instruction.kind !== "next") continue;
    const opened = stack.pop();
    if (!opened) continue;
    const body = instructions.slice(opened.index + 1, index);
    const following = instructions[index + 1];
    const hasExit = following?.kind === "label" && body.some((candidate) =>
      (candidate.kind === "goto" || candidate.kind === "if-goto") && candidate.label === following.name
    );
    const hasReturn = body.some(instructionContainsReturn);
    if (!hasExit && !hasReturn) continue;

    let loopLabel = "";
    while (!loopLabel) {
      const candidate = `__MB_AGON_FOR_${loopLabelSerial++}`;
      if (!usedLabels.has(candidate)) {
        usedLabels.add(candidate);
        loopLabel = candidate;
      }
    }
    contexts.push({
      forIndex: opened.index,
      nextIndex: index,
      loopLabel,
      variable: opened.instruction.variable,
      start: opened.instruction.start,
      limit: opened.instruction.limit,
      step: opened.instruction.step ?? numberExpression(1, opened.instruction.location),
      limitName: allocateLimitName(),
      stepName: allocateStepName()
    });
  }

  if (contexts.length === 0) return program;
  const byForIndex = new Map(contexts.map((context) => [context.forIndex, context]));
  const byNextIndex = new Map(contexts.map((context) => [context.nextIndex, context]));
  const lowered: Instruction[] = [];

  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    const forContext = byForIndex.get(index);
    if (instruction.kind === "for" && forContext) {
      lowered.push({ kind: "let", name: forContext.limitName, expression: forContext.limit, location: instruction.location });
      lowered.push({
        kind: "let",
        name: forContext.stepName,
        expression: forContext.step,
        location: instruction.location
      });
      lowered.push({ kind: "let", name: forContext.variable, expression: forContext.start, location: instruction.location });
      lowered.push({ kind: "label", name: forContext.loopLabel, internal: true, location: instruction.location });
      continue;
    }

    const nextContext = byNextIndex.get(index);
    if (instruction.kind === "next" && nextContext) {
      const variable = identifierExpression(nextContext.variable, instruction.location);
      const step = identifierExpression(nextContext.stepName, instruction.location);
      const limit = identifierExpression(nextContext.limitName, instruction.location);
      lowered.push({
        kind: "let",
        name: nextContext.variable,
        expression: binaryExpression("+", variable, step, instruction.location),
        location: instruction.location
      });
      lowered.push({
        kind: "if-goto",
        condition: binaryExpression(
          "OR",
          binaryExpression(
            "AND",
            binaryExpression(">=", step, numberExpression(0, instruction.location), instruction.location),
            binaryExpression("<=", variable, limit, instruction.location),
            instruction.location
          ),
          binaryExpression(
            "AND",
            binaryExpression("<", step, numberExpression(0, instruction.location), instruction.location),
            binaryExpression(">=", variable, limit, instruction.location),
            instruction.location
          ),
          instruction.location
        ),
        label: nextContext.loopLabel,
        location: instruction.location
      });
      continue;
    }
    lowered.push(instruction);
  }
  return rebuildLabels(program, lowered);
}

function instructionContainsReturn(instruction: Instruction): boolean {
  return instruction.kind === "return" || (instruction.kind === "if-then" && instruction.body.some(instructionContainsReturn));
}

function validateAgonInternationalStrings(program: LoweredProgram): LoweredProgram {
  return rebuildLabels(program, program.instructions.map((instruction) => {
    return mapInstructionExpressions(instruction, validateAgonInternationalStringExpression);
  }));
}

function validateAgonInternationalStringExpression(expression: Expression): Expression {
  switch (expression.kind) {
    case "string": {
      for (const char of expression.value) {
        if ((char.codePointAt(0) ?? 0) >= 128 && agonCharacterCode(char) === undefined) {
          throw new DiagnosticError(expression.location, `Unsupported Agon text character "${char}". Use a Windows-1252 character or a portable transliteration.`);
        }
      }
      break;
    }
    case "function-call":
      expression.args.forEach(validateAgonInternationalStringExpression);
      break;
    case "array-access":
    case "struct-field-access":
      expression.indices.forEach(validateAgonInternationalStringExpression);
      break;
    case "parenthesized":
      validateAgonInternationalStringExpression(expression.expression);
      break;
    case "unary":
      validateAgonInternationalStringExpression(expression.operand);
      break;
    case "binary":
      validateAgonInternationalStringExpression(expression.left);
      validateAgonInternationalStringExpression(expression.right);
      break;
  }
  return expression;
}

function agonCharacterCode(char: string): number | undefined {
  const code = char.codePointAt(0);
  if (code !== undefined && code >= 128 && code <= 255) return code;
  return new Map<string, number>([
    ["€", 128], ["‚", 130], ["ƒ", 131], ["„", 132], ["…", 133], ["†", 134], ["‡", 135],
    ["ˆ", 136], ["‰", 137], ["Š", 138], ["‹", 139], ["Œ", 140], ["Ž", 142], ["‘", 145],
    ["’", 146], ["“", 147], ["”", 148], ["•", 149], ["–", 150], ["—", 151], ["˜", 152],
    ["™", 153], ["š", 154], ["›", 155], ["œ", 156], ["ž", 158], ["Ÿ", 159]
  ]).get(char);
}

function lowerAgonScreenReads(program: LoweredProgram): LoweredProgram {
  const allocateRowName = createGeneratedVariableNameAllocator(program.instructions, "MBSCREENROW", "%");
  const allocateColumnName = createGeneratedVariableNameAllocator(program.instructions, "MBSCREENCOLUMN", "%");
  const allocateValueName = createGeneratedVariableNameAllocator(program.instructions, "MBSCREENVALUE", "%");
  const savedAName = allocateGeneratedVariableName(program.instructions, "MBSCREENA", "%");
  const savedLName = allocateGeneratedVariableName(program.instructions, "MBSCREENL", "%");
  const lowered: Instruction[] = [];

  for (const instruction of program.instructions) {
    const result = materializeAgonScreenReads(
      instruction,
      allocateRowName,
      allocateColumnName,
      allocateValueName,
      savedAName,
      savedLName
    );
    lowered.push(...result.prefix, result.instruction);
  }
  return rebuildLabels(program, lowered);
}

function materializeAgonScreenReads(
  instruction: Instruction,
  allocateRowName: () => string,
  allocateColumnName: () => string,
  allocateValueName: () => string,
  savedAName: string,
  savedLName: string
): { readonly prefix: readonly Instruction[]; readonly instruction: Instruction } {
  const prefix: Instruction[] = [];
  const rewrite = (expression: Expression): Expression => {
    const rewriteChild = (child: Expression): Expression => rewrite(child);
    switch (expression.kind) {
      case "function-call": {
        const args = expression.args.map(rewriteChild);
        if (expression.name !== builtinFunctions.screenCode) return { ...expression, args };
        const rowName = allocateRowName();
        const columnName = allocateColumnName();
        const valueName = allocateValueName();
        const row = args[0];
        const column = args[1];
        if (!row || !column) throw new Error("Internal error: malformed SCREEN_CODE call during Agon lowering.");
        prefix.push(
          { kind: "let", name: rowName, expression: row, location: expression.location },
          { kind: "let", name: columnName, expression: column, location: expression.location },
          { kind: "let", name: savedAName, expression: identifierExpression("A%", expression.location), location: expression.location },
          { kind: "let", name: savedLName, expression: identifierExpression("L%", expression.location), location: expression.location },
          {
            kind: "vdu",
            items: [
              { expression: numberExpression(23, expression.location), word: false },
              { expression: numberExpression(0, expression.location), word: false },
              { expression: numberExpression(131, expression.location), word: false },
              { expression: subtractOne(identifierExpression(columnName, expression.location), expression.location), word: true },
              { expression: subtractOne(identifierExpression(rowName, expression.location), expression.location), word: true }
            ],
            location: expression.location
          },
          { kind: "let", name: "A%", expression: numberExpression(19, expression.location), location: expression.location },
          {
            kind: "let",
            name: valueName,
            expression: {
              kind: "function-call",
              name: "USR",
              args: [numberExpression(65524, expression.location)],
              valueType: "number",
              location: expression.location
            },
            location: expression.location
          },
          { kind: "let", name: "A%", expression: numberExpression(160, expression.location), location: expression.location },
          { kind: "let", name: "L%", expression: numberExpression(9, expression.location), location: expression.location },
          {
            kind: "let",
            name: valueName,
            expression: {
              kind: "function-call",
              name: "USR",
              args: [numberExpression(65524, expression.location)],
              valueType: "number",
              location: expression.location
            },
            location: expression.location
          },
          { kind: "let", name: "A%", expression: identifierExpression(savedAName, expression.location), location: expression.location },
          { kind: "let", name: "L%", expression: identifierExpression(savedLName, expression.location), location: expression.location }
        );
        return identifierExpression(valueName, expression.location);
      }
      case "array-access":
        return { ...expression, indices: expression.indices.map(rewriteChild) };
      case "struct-field-access":
        return { ...expression, indices: expression.indices.map(rewriteChild) };
      case "parenthesized":
        return { ...expression, expression: rewriteChild(expression.expression) };
      case "unary":
        return { ...expression, operand: rewriteChild(expression.operand) };
      case "binary":
        return { ...expression, left: rewriteChild(expression.left), right: rewriteChild(expression.right) };
      case "identifier":
      case "number":
      case "string":
      case "boolean":
      case "color":
        return expression;
    }
  };

  if (instruction.kind === "if-then") {
    const condition = rewrite(instruction.condition);
    const body: Instruction[] = [];
    for (const bodyInstruction of instruction.body) {
      const nested = materializeAgonScreenReads(
        bodyInstruction,
        allocateRowName,
        allocateColumnName,
        allocateValueName,
        savedAName,
        savedLName
      );
      body.push(...nested.prefix, nested.instruction);
    }
    return { prefix, instruction: { ...instruction, condition, body } };
  }
  return { prefix, instruction: mapInstructionExpressions(instruction, rewrite) };
}

/**
 * Agon has no text-inverse mode. Read the current logical foreground and
 * background colours once at the start of each adjacent inverse-print run,
 * swap them, then restore them at the end of the run.
 */
function lowerAgonInverseText(program: LoweredProgram): LoweredProgram {
  if (!program.instructions.some((instruction) => instruction.kind === "inverse-text")) return program;

  const foregroundName = allocateGeneratedVariableName(program.instructions, "MBINVERSEFOREGROUND", "%");
  const backgroundName = allocateGeneratedVariableName(program.instructions, "MBINVERSEBACKGROUND", "%");
  const savedAName = allocateGeneratedVariableName(program.instructions, "MBINVERSEA", "%");
  const savedLName = allocateGeneratedVariableName(program.instructions, "MBINVERSEL", "%");
  const instructions: Instruction[] = [];

  for (const instruction of program.instructions) {
    if (instruction.kind !== "inverse-text") {
      instructions.push(instruction);
      continue;
    }

    const location = instruction.location;
    if (instruction.enabled) {
      instructions.push(
        { kind: "let", name: savedAName, expression: identifierExpression("A%", location), location },
        { kind: "let", name: savedLName, expression: identifierExpression("L%", location), location },
        ...agonReadCurrentTextColor(128, foregroundName, location),
        ...agonReadCurrentTextColor(129, backgroundName, location),
        { kind: "let", name: "A%", expression: identifierExpression(savedAName, location), location },
        { kind: "let", name: "L%", expression: identifierExpression(savedLName, location), location },
        agonTextColor(identifierExpression(backgroundName, location), location),
        agonTextColor(binaryExpression("+", numberExpression(128, location), identifierExpression(foregroundName, location), location), location)
      );
    } else {
      instructions.push(
        agonTextColor(identifierExpression(foregroundName, location), location),
        agonTextColor(binaryExpression("+", numberExpression(128, location), identifierExpression(backgroundName, location), location), location)
      );
    }
  }

  return rebuildLabels(program, instructions);
}

function agonReadCurrentTextColor(
  selector: 128 | 129,
  resultName: string,
  location: Expression["location"]
): readonly Instruction[] {
  return [
    {
      kind: "vdu",
      items: [23, 0, 148, selector].map((value) => ({ expression: numberExpression(value, location), word: false })),
      location
    },
    { kind: "let", name: "A%", expression: numberExpression(19, location), location },
    { kind: "let", name: resultName, expression: agonUsrExpression(location), location },
    { kind: "let", name: "A%", expression: numberExpression(160, location), location },
    { kind: "let", name: "L%", expression: numberExpression(22, location), location },
    { kind: "let", name: resultName, expression: agonUsrExpression(location), location }
  ];
}

function agonTextColor(color: Expression, location: Expression["location"]): Instruction {
  return {
    kind: "vdu",
    items: [
      { expression: numberExpression(17, location), word: false },
      { expression: color, word: false }
    ],
    location
  };
}

function agonUsrExpression(location: Expression["location"]): Expression {
  return {
    kind: "function-call",
    name: "USR",
    args: [numberExpression(65524, location)],
    valueType: "number",
    location
  };
}

function numberExpression(value: number, location: Expression["location"]): Expression {
  return { kind: "number", value, raw: String(value), location };
}

function identifierExpression(name: string, location: Expression["location"]): Expression {
  return { kind: "identifier", name, valueType: "number", location };
}

function binaryExpression(
  operator: Extract<Expression, { kind: "binary" }>["operator"],
  left: Expression,
  right: Expression,
  location: Expression["location"]
): Expression {
  return { kind: "binary", operator, left, right, location };
}

function subtractOne(expression: Expression, location: Expression["location"]): Expression {
  return { kind: "binary", operator: "-", left: expression, right: numberExpression(1, location), location };
}

const renderKnownAgonFunction = createFunctionRenderer(new Map([
  [builtinFunctions.abs, renderUnary],
  [builtinFunctions.asc, renderUnary],
  [builtinFunctions.atn, renderUnary],
  [builtinFunctions.chr, renderUnary],
  [builtinFunctions.code, renderAgonAsc],
  [builtinFunctions.cos, renderUnary],
  [builtinFunctions.exp, renderUnary],
  [builtinFunctions.freeMemory, () => "(HIMEM-TOP)"],
  [builtinFunctions.getJoystick, renderAgonJoystick],
  [builtinFunctions.int, renderUnary],
  [builtinFunctions.jiffies, () => "TIME"],
  [builtinFunctions.keyCode, () => "INKEY(0)"],
  [builtinFunctions.keyPressed, () => "(INKEY(0)<>-1)"],
  [builtinFunctions.left, renderArgs],
  [builtinFunctions.len, renderUnary],
  [builtinFunctions.mid, renderArgs],
  [builtinFunctions.rnd, renderAgonRnd],
  [builtinFunctions.right, renderArgs],
  [builtinFunctions.sgn, renderUnary],
  [builtinFunctions.sin, renderUnary],
  [builtinFunctions.sqr, renderUnary],
  [builtinFunctions.str, renderUnary],
  [builtinFunctions.val, renderUnary]
]));

function renderAgonFunction(expression: FunctionCallExpression, options: ExpressionRenderOptions): string | undefined {
  if (expression.name === "USR") return renderArgs(expression, options);
  return renderKnownAgonFunction(expression, options);
}

function renderUnary(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  return `${expression.name.toUpperCase()}(${renderExpression(expression.args[0], options)})`;
}

function renderAgonAsc(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  return `ASC(${renderExpression(expression.args[0], options)})`;
}

function renderArgs(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  return `${expression.name.toUpperCase()}(${expression.args.map((argument) => renderExpression(argument, options)).join(",")})`;
}

function renderAgonRnd(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  return expression.args.length === 0 ? "RND(1)" : `RND(${renderExpression(expression.args[0], options)})`;
}

function renderAgonDeviceOutput(
  instruction: Extract<Instruction, { kind: "print-device" }>,
  options: ExpressionRenderOptions
): string {
  const renderedHandle = deviceHandleName(instruction.handle);
  if (!instruction.textBufferName || !instruction.textIndexName) {
    throw new Error("Internal error: Agon device output has no text-buffer storage.");
  }
  const buffer = renderVariableName(instruction.textBufferName, options.variableMap ?? new Map());
  const index = renderVariableName(instruction.textIndexName, options.variableMap ?? new Map());
  const text = instruction.items.map((item) => {
    const expression = renderExpression(item, options);
    return agonExpressionValueType(item) === "string" ? expression : `STR$(${expression})`;
  }).join("+") || '""';
  const lineFeed = instruction.trailingSemicolon ? "" : `:BPUT#${renderedHandle},10`;
  return `${buffer}=${text}:FOR ${index}=1 TO LEN(${buffer}):BPUT#${renderedHandle},ASC(MID$(${buffer},${index},1)):NEXT${lineFeed}`;
}

function agonExpressionValueType(expression: Expression): "number" | "string" {
  switch (expression.kind) {
    case "string":
      return "string";
    case "identifier":
      return isStringVariableName(expression.name) ? "string" : "number";
    case "array-access":
    case "function-call":
      return expression.valueType === "string" || isStringVariableName(expression.name) ? "string" : "number";
    case "struct-field-access":
      return expression.valueType === "string" || isStringVariableName(expression.field) ? "string" : "number";
    case "parenthesized":
      return agonExpressionValueType(expression.expression);
    case "binary":
      return expression.operator === "+" && (agonExpressionValueType(expression.left) === "string" || agonExpressionValueType(expression.right) === "string")
        ? "string"
        : "number";
    case "number":
    case "boolean":
    case "color":
    case "unary":
      return "number";
  }
}

function renderAgonJoystick(expression: FunctionCallExpression): string {
  return [
    "(-INKEY(-56)+INKEY(-55))",
    "(-INKEY(-66)+INKEY(-17))",
    "(-INKEY(-99))"
  ][joystickControl(expression.args[0])];
}

function renderAgonArrayAccess(expression: Extract<Expression, { kind: "array-access" }>, options: ExpressionRenderOptions): string {
  return `${renderVariableName(expression.name, options.variableMap ?? new Map())}(${expression.indices.map((index) => renderExpression(index, options)).join(",")})`;
}

function agonArrayDimensions(name: string, dimensions: readonly number[]): readonly number[] {
  const storageDimensions = isStringVariableName(name) ? dimensions.slice(0, -1) : dimensions;
  return storageDimensions.map((dimension) => dimension - 1);
}

function buildAgonVariableMap(instructions: readonly Instruction[], _readability: ReadabilityLevel): ReadonlyMap<string, string> {
  const names = new Set<string>();
  for (const instruction of instructions) {
    for (const name of instructionNames(instruction)) names.add(name);
    for (const expression of instructionExpressions(instruction)) collectExpressionNames(expression, names);
  }
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const name of names) {
    const suffix = isStringVariableName(name) ? "$" : isIntegerVariableName(name) ? "%" : "";
    const base = name.replace(/[$%]$/u, "").toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_") || "V";
    const safeBase = startsWithAgonKeyword(base) ? `V_${base}` : base;
    let candidate = `${safeBase}${suffix}`;
    let serial = 1;
    while (used.has(candidate)) candidate = `${safeBase}_${serial++}${suffix}`;
    result.set(name.toLowerCase(), candidate);
    used.add(candidate);
  }
  return result;
}

function startsWithAgonKeyword(name: string): boolean {
  return agonKeywordPrefixes.some((keyword) => name.startsWith(keyword));
}

const agonKeywordPrefixes = [
  "ABS", "ACS", "ADVAL", "AND", "ASC", "ASN", "ATN", "AUTO",
  "BGET", "BPUT", "BY", "CALL", "CASE", "CHAIN", "CHR", "CIRCLE", "CLEAR", "CLG", "CLOSE", "CLS", "COLOUR", "COS", "COUNT",
  "DATA", "DEF", "DEG", "DELETE", "DIM", "DIV", "DRAW", "ELSE", "END", "EOF", "EOR", "ERL", "ERR", "ERROR", "EVAL", "EXP", "EXT",
  "FALSE", "FILL", "FN", "FOR", "GCOL", "GET", "GOSUB", "GOTO", "HIMEM", "IF", "INKEY", "INPUT", "INSTR", "INT",
  "LEFT", "LEN", "LET", "LIST", "LN", "LOAD", "LOCAL", "LOMEM", "MID", "MOD", "MODE", "MOVE", "NEW", "NEXT", "NOT",
  "OFF", "OLD", "ON", "OPENIN", "OPENOUT", "OPENUP", "OR", "ORIGIN", "OSCLI", "PAGE", "PI", "PLOT", "POINT", "POS", "PRINT", "PROC", "PTR",
  "QUIT", "RAD", "READ", "RECTANGLE", "REM", "REPEAT", "REPORT", "RESTORE", "RETURN", "RIGHT", "RND", "RUN", "SAVE", "SGN", "SIN", "SOUND",
  "SPC", "SQR", "STEP", "STOP", "STR", "STRING", "SUM", "SWAP", "TAB", "TAN", "THEN", "TIME", "TINT", "TO", "TOP", "TRACE", "TRUE",
  "UNTIL", "USR", "VAL", "VDU", "VPOS", "WAIT", "WHEN", "WHILE", "WIDTH"
] as const;

function instructionNames(instruction: Instruction): readonly string[] {
  switch (instruction.kind) {
    case "let":
    case "check-device":
    case "read-key":
    case "dim-array":
    case "array-let":
    case "dim-string":
      return [instruction.name];
    case "multi-let":
      return instruction.assignments.map((assignment) => assignment.name);
    case "read":
    case "input":
      return instruction.targets;
    case "print-device":
      return [instruction.textBufferName, instruction.textIndexName].filter((name): name is string => name !== undefined);
    case "for":
    case "next":
      return [instruction.variable];
    default:
      return [];
  }
}

function collectExpressionNames(expression: Expression, names: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      names.add(expression.name);
      break;
    case "array-access":
      names.add(expression.name);
      expression.indices.forEach((index) => collectExpressionNames(index, names));
      break;
    case "struct-field-access":
      names.add(expression.base);
      expression.indices.forEach((index) => collectExpressionNames(index, names));
      break;
    case "function-call":
      expression.args.forEach((argument) => collectExpressionNames(argument, names));
      break;
    case "parenthesized":
      collectExpressionNames(expression.expression, names);
      break;
    case "unary":
      collectExpressionNames(expression.operand, names);
      break;
    case "binary":
      collectExpressionNames(expression.left, names);
      collectExpressionNames(expression.right, names);
      break;
    default:
      break;
  }
}

function renderVariableName(name: string, variableMap: ReadonlyMap<string, string>): string {
  return variableMap.get(name.toLowerCase()) ?? name.toUpperCase();
}

function lowerSafeDispatch(instruction: Extract<Instruction, { kind: "on-goto" | "on-gosub" }>): Instruction[] {
  return instruction.labels.map((label, index) => ({
    kind: instruction.kind === "on-goto" ? "if-goto" as const : "if-gosub" as const,
    condition: {
      kind: "binary" as const,
      operator: "=" as const,
      left: instruction.expression,
      right: { kind: "number" as const, value: index + 1, raw: String(index + 1), location: instruction.location },
      location: instruction.location
    },
    label,
    location: instruction.location
  }));
}

function deviceHandleName(handle: string): string {
  const handles: string[] = [];
  for (const instruction of currentProgramInstructions) {
    if (instruction.kind !== "open-device") continue;
    const key = instruction.handle.toLowerCase();
    if (!handles.includes(key)) handles.push(key);
  }
  return `MBDEVICE${Math.max(0, handles.indexOf(handle.toLowerCase()))}%`;
}

function deviceFileName(device: "printer" | "text-printer" | "shared-drive" | "rs232"): string {
  switch (device) {
    case "printer": return "PRINTER.DAT";
    case "text-printer": return "TEXTPRNT.DAT";
    case "shared-drive": return "MCP.DAT";
    case "rs232": return "RS232.DAT";
  }
}
