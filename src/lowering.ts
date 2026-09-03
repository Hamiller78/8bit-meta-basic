import type { DeviceKind, Expression, FunctionImplementation, Program, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import {
  collectFunctionImplementations,
  collectInlineFunctionImplementations,
  expandFunctionCallForSideEffect,
  expandFunctionCallIntoDestination,
  expandFunctionCalls,
  type FunctionCallLoweringContext,
  type InlineFunctionImplementation
} from "./function-call-lowering.js";
import { normalizeName } from "./symbols.js";
import { canonicalTestRuntimeSetterName, replaceTestRuntimeFunctionCalls, setterStorageName } from "./test-runtime.js";
import {
  capturedPrintExpression,
  captureTestColor,
  lowerAssertBoolean,
  lowerAssertColor,
  lowerAssertComparison,
  lowerAssertPrint,
  lowerAssertPrintAt,
  lowerTestRunner,
  testCellBackgroundColorName,
  testCellTextColorName,
  testOutputName,
  testPrintAtColumnName,
  testPrintAtOutputName,
  testPrintAtRowName,
  testScreenBackgroundColorName,
  testScreenBorderColorName,
  testScreenTextColorName
} from "./test-runner-lowering.js";

export interface LoweredProgram {
  readonly instructions: readonly Instruction[];
  readonly labels: ReadonlyMap<string, LabelDefinition>;
}

export interface LabelDefinition {
  readonly name: string;
  readonly index: number;
  readonly location: SourceLocation;
  readonly internal: boolean;
}

export type Instruction =
  | LabelInstruction
  | RemInstruction
  | ClsInstruction
  | BorderColorInstruction
  | TextColorInstruction
  | ScreenBackgroundColorInstruction
  | CellTextColorInstruction
  | CellBackgroundColorInstruction
  | SuppressScrollPromptInstruction
  | ProgramModeInstruction
  | PaperInstruction
  | PrintInstruction
  | OpenDeviceInstruction
  | PrintDeviceInstruction
  | CloseDeviceInstruction
  | CheckDeviceInstruction
  | TrapInstruction
  | WaitRs232TransmitInstruction
  | DataInstruction
  | ReadInstruction
  | RestoreInstruction
  | DimArrayInstruction
  | LetInstruction
  | MultiLetInstruction
  | ArrayLetInstruction
  | ReadKeyInstruction
  | RandomizeInstruction
  | GotoInstruction
  | GosubInstruction
  | ReturnInstruction
  | EndInstruction
  | ForInstruction
  | NextInstruction
  | IfGotoInstruction
  | PositionInstruction
  | SetColorInstruction
  | PokeInstruction
  | PrintChrInstruction
  | DimStringInstruction
  | SysInstruction;

export interface LabelInstruction {
  readonly kind: "label";
  readonly name: string;
  readonly internal: boolean;
  readonly location: SourceLocation;
}

export interface RemInstruction {
  readonly kind: "rem";
  readonly text: string;
  readonly sourceComment?: boolean;
  readonly location: SourceLocation;
}

export interface ClsInstruction {
  readonly kind: "cls";
  readonly color?: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface BorderColorInstruction {
  readonly kind: "border-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface TextColorInstruction {
  readonly kind: "text-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface ScreenBackgroundColorInstruction {
  readonly kind: "screen-background-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface CellTextColorInstruction {
  readonly kind: "cell-text-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface CellBackgroundColorInstruction {
  readonly kind: "cell-background-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface SuppressScrollPromptInstruction {
  readonly kind: "suppress-scroll-prompt";
  readonly location: SourceLocation;
}

export interface ProgramModeInstruction {
  readonly kind: "program-mode";
  readonly location: SourceLocation;
}

export interface PaperInstruction {
  readonly kind: "paper";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface PrintInstruction {
  readonly kind: "print";
  readonly items: readonly Expression[];
  readonly trailingSemicolon: boolean;
  readonly at?: {
    readonly row: Expression;
    readonly column: Expression;
  };
  readonly location: SourceLocation;
}

export interface OpenDeviceInstruction {
  readonly kind: "open-device";
  readonly handle: string;
  readonly device: DeviceKind;
  readonly location: SourceLocation;
}

export interface PrintDeviceInstruction {
  readonly kind: "print-device";
  readonly handle: string;
  readonly items: readonly Expression[];
  readonly trailingSemicolon: boolean;
  readonly location: SourceLocation;
}

export interface CloseDeviceInstruction {
  readonly kind: "close-device";
  readonly handle: string;
  readonly location: SourceLocation;
}

export interface CheckDeviceInstruction {
  readonly kind: "check-device";
  readonly name: string;
  readonly device: DeviceKind;
  readonly sourceName?: string;
  readonly location: SourceLocation;
}

export interface TrapInstruction {
  readonly kind: "trap";
  readonly label?: string;
  readonly location: SourceLocation;
}

export interface WaitRs232TransmitInstruction {
  readonly kind: "wait-rs232-transmit";
  readonly location: SourceLocation;
}

export interface DataInstruction {
  readonly kind: "data";
  readonly values: readonly Expression[];
  readonly location: SourceLocation;
}

export interface ReadInstruction {
  readonly kind: "read";
  readonly targets: readonly string[];
  readonly location: SourceLocation;
}

export interface RestoreInstruction {
  readonly kind: "restore";
  readonly location: SourceLocation;
}

export interface LetInstruction {
  readonly kind: "let";
  readonly name: string;
  readonly expression: Expression;
  readonly sourceName?: string;
  readonly location: SourceLocation;
}

export interface MultiLetInstruction {
  readonly kind: "multi-let";
  readonly assignments: readonly {
    readonly name: string;
    readonly expression: Expression;
    readonly location: SourceLocation;
  }[];
  readonly location: SourceLocation;
}

export interface DimArrayInstruction {
  readonly kind: "dim-array";
  readonly name: string;
  readonly dimensions: readonly number[];
  readonly location: SourceLocation;
}

export interface ArrayLetInstruction {
  readonly kind: "array-let";
  readonly name: string;
  readonly indices: readonly Expression[];
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface ReadKeyInstruction {
  readonly kind: "read-key";
  readonly name: string;
  readonly location: SourceLocation;
}

export interface RandomizeInstruction {
  readonly kind: "randomize";
  readonly seed?: Expression;
  readonly location: SourceLocation;
}

export interface GotoInstruction {
  readonly kind: "goto";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface GosubInstruction {
  readonly kind: "gosub";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface ReturnInstruction {
  readonly kind: "return";
  readonly location: SourceLocation;
}

export interface EndInstruction {
  readonly kind: "end";
  readonly location: SourceLocation;
}

export interface ForInstruction {
  readonly kind: "for";
  readonly variable: string;
  readonly start: Expression;
  readonly limit: Expression;
  readonly step?: Expression;
  readonly location: SourceLocation;
}

export interface NextInstruction {
  readonly kind: "next";
  readonly variable: string;
  readonly location: SourceLocation;
}

export interface IfGotoInstruction {
  readonly kind: "if-goto";
  readonly condition: Expression;
  readonly label: string;
  readonly location: SourceLocation;
}

export interface PositionInstruction {
  readonly kind: "position";
  readonly row: Expression;
  readonly column: Expression;
  readonly location: SourceLocation;
}

export interface SetColorInstruction {
  readonly kind: "setcolor";
  readonly register: number;
  readonly hue: number;
  readonly luminance: number;
  readonly location: SourceLocation;
}

export interface PokeInstruction {
  readonly kind: "poke";
  readonly address: number;
  readonly value: Expression;
  readonly location: SourceLocation;
}

export interface PrintChrInstruction {
  readonly kind: "print-chr";
  readonly code: number;
  readonly trailingSemicolon: boolean;
  readonly location: SourceLocation;
}

export interface DimStringInstruction {
  readonly kind: "dim-string";
  readonly name: string;
  readonly length: number;
  readonly location: SourceLocation;
}

export interface SysInstruction {
  readonly kind: "sys";
  readonly address: number;
  readonly location: SourceLocation;
}

export interface LowerOptions {
  readonly testMode?: boolean;
  readonly testPrinterOutput?: boolean;
  readonly testOutputDevice?: DeviceKind;
}

export function lowerProgram(program: Program, options: LowerOptions = {}): LoweredProgram {
  const userLabels = collectUserLabels(program.statements);
  const generator = internalLabelGenerator(userLabels);
  const functions = collectFunctionImplementations(program.statements);
  const inlineFunctions = collectInlineFunctionImplementations(program.statements);
  const context: FunctionCallLoweringContext = {
    functions,
    inlineFunctions,
    nextTempId: 1,
    ...(options.testMode ? { transformExpandedExpression: replaceTestRuntimeFunctionCalls } : {}),
    expandInlineFunctionCall: (definition, args, destinationName, targetInstructions) =>
      expandInlineFunctionCall(definition, args, destinationName, targetInstructions, generator, context, options)
  };
  const instructions: Instruction[] = [];

  const mainStatements = program.statements.filter((statement) => statement.kind !== "function" && statement.kind !== "test" && statement.kind !== "globals");
  const functionStatements = program.statements.filter((statement): statement is Extract<Statement, { kind: "function" }> => statement.kind === "function" && !statement.inline);
  const testStatements = program.statements.filter((statement): statement is Extract<Statement, { kind: "test" }> => statement.kind === "test");
  const globalsStatements = program.statements.filter((statement): statement is Extract<Statement, { kind: "globals" }> => statement.kind === "globals");
  const mainLayout = partitionTopLevelStatementsForInitialization(mainStatements);

  if (options.testMode) {
    const globalResetInstructions: Instruction[] = [];
    lowerStatements([...mainLayout.declarations, ...mainLayout.initializers], instructions, generator, context);
    for (const statement of globalsStatements) {
      lowerStatements(statement.body, globalResetInstructions, generator, context);
    }
    lowerTestRunner(testStatements, instructions, generator, {
      printerOutput: options.testPrinterOutput === true,
      outputDevice: options.testOutputDevice ?? "printer",
      globalResetInstructions
    });
  } else {
    lowerStatements([...mainLayout.declarations, ...mainLayout.initializers, ...mainLayout.body], instructions, generator, context);
  }

  if (testStatements.length > 0) {
    for (const statement of testStatements) {
      if (!statement.implementation) {
        throw new DiagnosticError(statement.location, `Internal error: TEST ${statement.name} was not analyzed before lowering.`);
      }
      instructions.push({ kind: "label", name: statement.implementation.entryLabel, internal: true, location: statement.location });
      lowerStatements(statement.body, instructions, generator, context, statement.implementation, { testMode: true, currentTestName: statement.name, capturePrints: true });
      if (instructions[instructions.length - 1]?.kind !== "return") {
        instructions.push({ kind: "return", location: statement.location });
      }
    }
  }

  if (functionStatements.length > 0) {
    const endLabel = generator();
    if (!options.testMode) {
      instructions.push({ kind: "goto", label: endLabel, location: functionStatements[0].location });
    }
    for (const statement of functionStatements) {
      if (!statement.implementation) {
        throw new DiagnosticError(statement.location, `Internal error: FUNCTION ${statement.name} was not analyzed before lowering.`);
      }
      instructions.push({ kind: "label", name: statement.implementation.entryLabel, internal: true, location: statement.location });
      lowerStatements(statement.body, instructions, generator, context, statement.implementation, {
        testMode: options.testMode === true,
        capturePrints: options.testMode === true
      });
      if (instructions[instructions.length - 1]?.kind !== "return") {
        instructions.push({ kind: "return", location: statement.location });
      }
    }
    if (!options.testMode) {
      instructions.push({ kind: "label", name: endLabel, internal: true, location: functionStatements[0].location });
    }
  }

  const labels = buildLabelMap(instructions);
  validateReferences(instructions, labels);

  return { instructions, labels };
}

interface TopLevelStatementLayout {
  readonly declarations: readonly Statement[];
  readonly initializers: readonly Statement[];
  readonly body: readonly Statement[];
}

function partitionTopLevelStatementsForInitialization(statements: readonly Statement[]): TopLevelStatementLayout {
  const filesWithRuntimeBody = collectFilesWithRuntimeBody(statements);
  const declarations: Statement[] = [];
  const initializers: Statement[] = [];
  const body: Statement[] = [];

  for (const statement of statements) {
    if (isTopLevelStorageDeclaration(statement)) {
      declarations.push(statement);
    } else if (isTopLevelInitializer(statement) && !filesWithRuntimeBody.has(statement.location.filename)) {
      initializers.push(statement);
    } else {
      body.push(statement);
    }
  }

  return { declarations, initializers, body };
}

function collectFilesWithRuntimeBody(statements: readonly Statement[]): ReadonlySet<string> {
  const files = new Set<string>();
  for (const statement of statements) {
    if (!isTopLevelDeclarationOrInitializer(statement)) {
      files.add(statement.location.filename);
    }
  }
  return files;
}

function isTopLevelDeclarationOrInitializer(statement: Statement): boolean {
  return isTopLevelStorageDeclaration(statement) || isTopLevelInitializer(statement) || isTopLevelCompileTimeDeclaration(statement);
}

function isTopLevelStorageDeclaration(statement: Statement): boolean {
  return statement.kind === "dim";
}

function isTopLevelInitializer(statement: Statement): boolean {
  return statement.kind === "let" || statement.kind === "array-let";
}

function isTopLevelCompileTimeDeclaration(statement: Statement): boolean {
  return statement.kind === "comment" || statement.kind === "const" || statement.kind === "enum" || statement.kind === "struct" || statement.kind === "local";
}

function splitSourceComment(text: string): readonly string[] {
  const maxLength = 60;
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt <= 0) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  chunks.push(remaining);
  return chunks;
}

interface LowerStatementOptions {
  readonly testMode?: boolean;
  readonly currentTestName?: string;
  readonly capturePrints?: boolean;
  readonly loopControls?: readonly LoopControl[];
}

interface LoopControl {
  readonly continueLabel: string;
  readonly exitLabel: string;
}

function lowerStatements(
  statements: readonly Statement[],
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  currentFunction?: FunctionImplementation,
  options: LowerStatementOptions = {}
): void {
  for (const statement of statements) {
    switch (statement.kind) {
      case "comment":
        for (const text of splitSourceComment(statement.text)) {
          instructions.push({ kind: "rem", text, sourceComment: true, location: statement.location });
        }
        break;
      case "const":
      case "local":
      case "enum":
      case "function":
      case "test":
      case "globals":
        break;
      case "struct":
        break;
        break;
      case "dim":
        instructions.push({
          kind: "dim-array",
          name: statement.name,
          dimensions: statement.dimensions.map((dimension) => {
            if (dimension.kind !== "number") {
              throw new DiagnosticError(dimension.location, "Internal error: array dimensions must be resolved before lowering.");
            }
            return dimension.value;
          }),
          location: statement.location
        });
        break;
      case "cls":
        if (options.capturePrints && statement.color) {
          instructions.push({
            kind: "let",
            name: testScreenBackgroundColorName,
            expression: numberExpression(colorNumber(statement.color as Extract<Expression, { kind: "color" }>), statement.location),
            location: statement.location
          });
        }
        if (options.capturePrints) {
          break;
        }
        instructions.push({
          kind: "cls",
          ...(statement.color ? { color: statement.color as Extract<Expression, { kind: "color" }> } : {}),
          location: statement.location
        });
        break;
      case "border-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testScreenBorderColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
          break;
        }
        instructions.push({
          kind: "border-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "text-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testScreenTextColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
          break;
        }
        instructions.push({
          kind: "text-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "screen-background-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testScreenBackgroundColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
          break;
        }
        instructions.push({
          kind: "screen-background-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "cell-text-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testCellTextColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
          break;
        }
        instructions.push({
          kind: "cell-text-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "cell-background-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testCellBackgroundColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
          break;
        }
        instructions.push({
          kind: "cell-background-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "suppress-scroll-prompt":
        if (!options.capturePrints) {
          instructions.push({ kind: "suppress-scroll-prompt", location: statement.location });
        }
        break;
      case "program-mode":
        if (!options.capturePrints) {
          instructions.push({ kind: "program-mode", location: statement.location });
        }
        break;
      case "label":
        instructions.push({ kind: "label", name: statement.name, internal: false, location: statement.location });
        break;
      case "print":
        {
          const at = statement.at
            ? {
                row: lowerExpression(statement.at.row, instructions, context, options),
                column: lowerExpression(statement.at.column, instructions, context, options)
              }
            : undefined;
          const items = statement.items.map((item) => lowerExpression(item, instructions, context, options));
          if (options.capturePrints && at) {
            instructions.push({ kind: "let", name: testPrintAtRowName, expression: at.row, location: statement.location });
            instructions.push({ kind: "let", name: testPrintAtColumnName, expression: at.column, location: statement.location });
            instructions.push({
              kind: "let",
              name: testPrintAtOutputName,
              expression: capturedPrintExpression(items, statement.location),
              location: statement.location
            });
          } else if (options.capturePrints) {
            instructions.push({
              kind: "let",
              name: testOutputName,
              expression: capturedPrintExpression(items, statement.location),
              location: statement.location
            });
          }
          if (options.capturePrints) {
            break;
          }
          instructions.push({
            kind: "print",
            items,
            trailingSemicolon: statement.trailingSemicolon,
            ...(at ? { at } : {}),
            location: statement.location
          });
        }
        break;
      case "open-device":
        if (!options.capturePrints) {
          instructions.push({ kind: "open-device", handle: statement.handle, device: statement.device, location: statement.location });
        }
        break;
      case "print-device":
        if (!options.capturePrints) {
          instructions.push({
            kind: "print-device",
            handle: statement.handle,
            items: statement.items.map((item) => lowerExpression(item, instructions, context, options)),
            trailingSemicolon: statement.trailingSemicolon,
            location: statement.location
          });
        }
        break;
      case "close-device":
        if (!options.capturePrints) {
          instructions.push({ kind: "close-device", handle: statement.handle, location: statement.location });
        }
        break;
      case "assert-true":
        lowerAssertBoolean(statement.actual, true, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-false":
        lowerAssertBoolean(statement.actual, false, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-eq":
      case "assert-ne":
        if (!statement.expected) {
          throw new DiagnosticError(statement.location, "Internal error: ASSERT_EQ/ASSERT_NE missing expected expression.");
        }
        lowerAssertComparison(statement.kind, statement.expected, statement.actual, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-print":
        lowerAssertPrint(statement.actual, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-printat":
        if (!statement.row || !statement.column) {
          throw new DiagnosticError(statement.location, "Internal error: ASSERT_PRINTAT missing row or column expression.");
        }
        lowerAssertPrintAt(statement.row, statement.column, statement.actual, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-screen-border-color":
        lowerAssertColor("ASSERT_SCREEN_BORDER_COLOR", testScreenBorderColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-screen-background-color":
        lowerAssertColor("ASSERT_SCREEN_BACKGROUND_COLOR", testScreenBackgroundColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-screen-text-color":
        lowerAssertColor("ASSERT_SCREEN_TEXT_COLOR", testScreenTextColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-cell-text-color":
        lowerAssertColor("ASSERT_CELL_TEXT_COLOR", testCellTextColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-cell-background-color":
        lowerAssertColor("ASSERT_CELL_BACKGROUND_COLOR", testCellBackgroundColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "data":
        instructions.push({ kind: "data", values: statement.values, location: statement.location });
        break;
      case "read":
        instructions.push({ kind: "read", targets: statement.targets, location: statement.location });
        break;
      case "restore":
        instructions.push({ kind: "restore", location: statement.location });
        break;
      case "let":
        if (!expandFunctionCallIntoDestination(statement.expression, statement.name, instructions, context, statement.sourceName)) {
          instructions.push({
            kind: "let",
            name: statement.name,
            expression: lowerExpression(statement.expression, instructions, context, options),
            ...(statement.sourceName ? { sourceName: statement.sourceName } : {}),
            location: statement.location
          });
        }
        break;
      case "array-let":
        instructions.push({
          kind: "array-let",
          name: statement.name,
          indices: statement.indices.map((index) => lowerExpression(index, instructions, context, options)),
          expression: lowerExpression(statement.expression, instructions, context, options),
          location: statement.location
        });
        break;
      case "struct-field-let":
        throw new DiagnosticError(statement.location, "Internal error: struct field assignments must be resolved before lowering.");
      case "insert-element":
        lowerElementMove(statement, "insert", instructions, nextInternalLabel, context, options);
        break;
      case "remove-element":
        lowerElementMove(statement, "remove", instructions, nextInternalLabel, context, options);
        break;
      case "function-call-statement":
        {
          const setter = canonicalTestRuntimeSetterName(statement.expression.name);
          if (setter) {
            instructions.push({ kind: "let", name: setterStorageName(setter), expression: lowerExpression(statement.expression.args[0], instructions, context, options), location: statement.location });
            break;
          }
          expandFunctionCallForSideEffect(statement.expression, instructions, context);
        }
        break;
      case "randomize":
        instructions.push({
          kind: "randomize",
          ...(statement.seed ? { seed: lowerExpression(statement.seed, instructions, context, options) } : {}),
          location: statement.location
        });
        break;
      case "goto":
        instructions.push({ kind: "goto", label: statement.label, location: statement.location });
        break;
      case "gosub":
        instructions.push({ kind: "gosub", label: statement.label, location: statement.location });
        break;
      case "return":
        if (currentFunction && statement.expression) {
          if (!expandFunctionCallIntoDestination(statement.expression, currentFunction.returnName, instructions, context)) {
            instructions.push({
              kind: "let",
              name: currentFunction.returnName,
              expression: lowerExpression(statement.expression, instructions, context, options),
              location: statement.location
            });
          }
        }
        instructions.push({ kind: "return", location: statement.location });
        break;
      case "end":
        instructions.push({ kind: "end", location: statement.location });
        break;
      case "for":
        {
          const start = lowerExpression(statement.start, instructions, context, options);
          const limit = lowerExpression(statement.limit, instructions, context, options);
          const step = statement.step ? lowerExpression(statement.step, instructions, context, options) : undefined;
          const staticBehavior = forLoopStaticBehavior(start, limit, step);

          if (staticBehavior === "skips") {
            break;
          }

          const bodyHasExitFor = containsCurrentForControl(statement.body, "exit-for");
          const bodyHasContinueFor = containsCurrentForControl(statement.body, "continue-for");
          const bodyHasForControl = bodyHasExitFor || bodyHasContinueFor;
          const exitLabel = staticBehavior === "unknown" || bodyHasForControl ? nextInternalLabel() : undefined;
          const continueLabel = bodyHasForControl ? nextInternalLabel() : undefined;
          const loopControls = exitLabel && continueLabel ? [...(options.loopControls ?? []), { continueLabel, exitLabel }] : options.loopControls;
          const skipLabel = staticBehavior === "unknown" ? exitLabel : undefined;
          if (skipLabel) {
            instructions.push({ kind: "if-goto", condition: forLoopSkipCondition(start, limit, step, statement.location), label: skipLabel, location: statement.location });
          }

          instructions.push({
          kind: "for",
          variable: statement.variable,
          start,
          limit,
          ...(step ? { step } : {}),
          location: statement.location
        });
          lowerStatements(statement.body, instructions, nextInternalLabel, context, currentFunction, { ...options, loopControls });
          if (continueLabel) {
            instructions.push({ kind: "label", name: continueLabel, internal: true, location: statement.location });
          }
          instructions.push({ kind: "next", variable: statement.variable, location: statement.location });
          if (exitLabel) {
            instructions.push({ kind: "label", name: exitLabel, internal: true, location: statement.location });
          }
        }
        break;
      case "exit-for": {
        const loopControl = options.loopControls?.[options.loopControls.length - 1];
        if (!loopControl) {
          throw new DiagnosticError(statement.location, "Internal error: EXIT FOR missing loop target.");
        }
        instructions.push({ kind: "goto", label: loopControl.exitLabel, location: statement.location });
        break;
      }
      case "continue-for": {
        const loopControl = options.loopControls?.[options.loopControls.length - 1];
        if (!loopControl) {
          throw new DiagnosticError(statement.location, "Internal error: CONTINUE FOR missing loop target.");
        }
        instructions.push({ kind: "goto", label: loopControl.continueLabel, location: statement.location });
        break;
      }
      case "while": {
        const startLabel = nextInternalLabel();
        const bodyLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();

        instructions.push({ kind: "label", name: startLabel, internal: true, location: statement.location });
        instructions.push({ kind: "if-goto", condition: expandConditionExpression(statement.condition, instructions, context, options), label: bodyLabel, location: statement.location });
        instructions.push({ kind: "goto", label: endLabel, location: statement.location });
        instructions.push({ kind: "label", name: bodyLabel, internal: true, location: statement.location });
        lowerStatements(statement.body, instructions, nextInternalLabel, context, currentFunction, options);
        instructions.push({ kind: "goto", label: startLabel, location: statement.location });
        instructions.push({ kind: "label", name: endLabel, internal: true, location: statement.location });
        break;
      }
      case "repeat-until": {
        const startLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();

        instructions.push({ kind: "label", name: startLabel, internal: true, location: statement.location });
        lowerStatements(statement.body, instructions, nextInternalLabel, context, currentFunction, options);
        instructions.push({ kind: "if-goto", condition: expandConditionExpression(statement.condition, instructions, context, options), label: endLabel, location: statement.location });
        instructions.push({ kind: "goto", label: startLabel, location: statement.location });
        instructions.push({ kind: "label", name: endLabel, internal: true, location: statement.location });
        break;
      }
      case "if": {
        const thenLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();

        if (statement.elseBranch.length > 0) {
          instructions.push({ kind: "if-goto", condition: expandConditionExpression(statement.condition, instructions, context, options), label: thenLabel, location: statement.location });
          lowerStatements(statement.elseBranch, instructions, nextInternalLabel, context, currentFunction, options);
          instructions.push({ kind: "goto", label: endLabel, location: statement.location });
          instructions.push({ kind: "label", name: thenLabel, internal: true, location: statement.location });
          lowerStatements(statement.thenBranch, instructions, nextInternalLabel, context, currentFunction, options);
        } else {
          instructions.push({ kind: "if-goto", condition: expandConditionExpression(statement.condition, instructions, context, options), label: thenLabel, location: statement.location });
          instructions.push({ kind: "goto", label: endLabel, location: statement.location });
          instructions.push({ kind: "label", name: thenLabel, internal: true, location: statement.location });
          lowerStatements(statement.thenBranch, instructions, nextInternalLabel, context, currentFunction, options);
        }

        instructions.push({ kind: "label", name: endLabel, internal: true, location: statement.location });
        break;
      }
    }
  }
}

function lowerExpression(expression: Expression, instructions: Instruction[], context: FunctionCallLoweringContext, options: LowerOptions): Expression {
  const expanded = expandFunctionCalls(expression, instructions, context);
  return options.testMode ? replaceTestRuntimeFunctionCalls(expanded) : expanded;
}

function expandConditionExpression(expression: Expression, instructions: Instruction[], context: FunctionCallLoweringContext, options: LowerOptions): Expression {
  return preserveComplexModuloOperands(lowerExpression(expression, instructions, context, options), instructions, context);
}

function preserveComplexModuloOperands(expression: Expression, instructions: Instruction[], context: FunctionCallLoweringContext): Expression {
  switch (expression.kind) {
    case "binary": {
      const left = preserveComplexModuloOperands(expression.left, instructions, context);
      const right = preserveComplexModuloOperands(expression.right, instructions, context);
      if (expression.operator !== "MOD") {
        return { ...expression, left, right };
      }
      return {
        ...expression,
        left: preserveModuloOperand(left, instructions, context),
        right: preserveModuloOperand(right, instructions, context)
      };
    }
    case "parenthesized":
      return { ...expression, expression: preserveComplexModuloOperands(expression.expression, instructions, context) };
    case "unary":
      return { ...expression, operand: preserveComplexModuloOperands(expression.operand, instructions, context) };
    case "function-call":
      return { ...expression, args: expression.args.map((arg) => preserveComplexModuloOperands(arg, instructions, context)) };
    case "array-access":
      return { ...expression, indices: expression.indices.map((index) => preserveComplexModuloOperands(index, instructions, context)) };
    case "struct-field-access":
      return { ...expression, indices: expression.indices.map((index) => preserveComplexModuloOperands(index, instructions, context)) };
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
      return expression;
  }
}

function preserveModuloOperand(expression: Expression, instructions: Instruction[], context: FunctionCallLoweringContext): Expression {
  if (expression.kind === "number" || expression.kind === "identifier" || expression.kind === "array-access") {
    return expression;
  }
  const name = `MBT${context.nextTempId++}`;
  instructions.push({ kind: "let", name, expression, location: expression.location });
  return { kind: "identifier", name, location: expression.location };
}

function lowerElementMove(
  statement: Extract<Statement, { kind: "insert-element" | "remove-element" }>,
  mode: "insert" | "remove",
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  options: LowerOptions
): void {
  if (statement.elementCount === undefined || !statement.fields) {
    throw new DiagnosticError(statement.location, `Internal error: ${mode === "insert" ? "INSERT_ELEMENT" : "REMOVE_ELEMENT"} was not analyzed before lowering.`);
  }

  const indexName = `MBT${context.nextTempId++}`;
  instructions.push({ kind: "let", name: indexName, expression: lowerExpression(statement.index, instructions, context, options), location: statement.location });
  const indexExpression = { kind: "identifier", name: indexName, location: statement.location } satisfies Expression;

  if (mode === "insert") {
    const insertValues = statement.fields.map((field) => {
      if (!("insertExpression" in field)) {
        throw new DiagnosticError(statement.location, "Internal error: INSERT_ELEMENT field is missing an insertion value.");
      }
      const tempName = `MBT${context.nextTempId++}${field.valueType === "string" ? "$" : ""}`;
      instructions.push({ kind: "let", name: tempName, expression: lowerExpression(field.insertExpression, instructions, context, options), location: statement.location });
      return { arrayName: field.arrayName, tempName };
    });

    const loopName = `MBT${context.nextTempId++}`;
    const startLabel = nextInternalLabel();
    const doneLabel = nextInternalLabel();
    const loopExpression = { kind: "identifier", name: loopName, location: statement.location } satisfies Expression;
    instructions.push({ kind: "let", name: loopName, expression: numberExpression(statement.elementCount - 2, statement.location), location: statement.location });
    instructions.push({ kind: "label", name: startLabel, internal: true, location: statement.location });
    instructions.push({ kind: "if-goto", condition: binaryExpression("<", loopExpression, indexExpression, statement.location), label: doneLabel, location: statement.location });
    for (const field of statement.fields) {
      instructions.push({
        kind: "array-let",
        name: field.arrayName,
        indices: [binaryExpression("+", loopExpression, numberExpression(1, statement.location), statement.location)],
        expression: { kind: "array-access", name: field.arrayName, indices: [loopExpression], valueType: field.valueType, location: statement.location },
        location: statement.location
      });
    }
    instructions.push({ kind: "let", name: loopName, expression: binaryExpression("-", loopExpression, numberExpression(1, statement.location), statement.location), location: statement.location });
    instructions.push({ kind: "goto", label: startLabel, location: statement.location });
    instructions.push({ kind: "label", name: doneLabel, internal: true, location: statement.location });
    for (const field of insertValues) {
      instructions.push({
        kind: "array-let",
        name: field.arrayName,
        indices: [indexExpression],
        expression: { kind: "identifier", name: field.tempName, location: statement.location },
        location: statement.location
      });
    }
    return;
  }

  const loopName = `MBT${context.nextTempId++}`;
  const startLabel = nextInternalLabel();
  const doneLabel = nextInternalLabel();
  const loopExpression = { kind: "identifier", name: loopName, location: statement.location } satisfies Expression;
  instructions.push({ kind: "let", name: loopName, expression: indexExpression, location: statement.location });
  instructions.push({ kind: "label", name: startLabel, internal: true, location: statement.location });
  instructions.push({ kind: "if-goto", condition: binaryExpression(">=", loopExpression, numberExpression(statement.elementCount - 1, statement.location), statement.location), label: doneLabel, location: statement.location });
  for (const field of statement.fields) {
    instructions.push({
      kind: "array-let",
      name: field.arrayName,
      indices: [loopExpression],
      expression: {
        kind: "array-access",
        name: field.arrayName,
        indices: [binaryExpression("+", loopExpression, numberExpression(1, statement.location), statement.location)],
        valueType: field.valueType,
        location: statement.location
      },
      location: statement.location
    });
  }
  instructions.push({ kind: "let", name: loopName, expression: binaryExpression("+", loopExpression, numberExpression(1, statement.location), statement.location), location: statement.location });
  instructions.push({ kind: "goto", label: startLabel, location: statement.location });
  instructions.push({ kind: "label", name: doneLabel, internal: true, location: statement.location });
}

function containsCurrentForControl(statements: readonly Statement[], kind: "exit-for" | "continue-for"): boolean {
  for (const statement of statements) {
    if (statement.kind === kind) {
      return true;
    }
    if (statement.kind === "if") {
      if (containsCurrentForControl(statement.thenBranch, kind) || containsCurrentForControl(statement.elseBranch, kind)) {
        return true;
      }
    } else if (statement.kind === "while" || statement.kind === "repeat-until") {
      if (containsCurrentForControl(statement.body, kind)) {
        return true;
      }
    }
  }
  return false;
}

function expandInlineFunctionCall(
  definition: InlineFunctionImplementation,
  args: readonly Expression[],
  destinationName: string | undefined,
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  options: LowerOptions
): Expression | undefined {
  const parameters = new Map<string, Expression>();
  for (let index = 0; index < args.length; index += 1) {
    parameters.set(normalizeName(definition.implementation.parameters[index].storageName), args[index]);
  }

  const body = substituteInlineStatements(definition.body, parameters);
  const final = body[body.length - 1];
  const bodyWithoutFinalReturn = final?.kind === "return" ? body.slice(0, -1) : body;
  lowerStatements(bodyWithoutFinalReturn, instructions, nextInternalLabel, context, undefined, options);

  if (destinationName && final?.kind === "return" && final.expression) {
    if (!expandFunctionCallIntoDestination(final.expression, destinationName, instructions, context)) {
      instructions.push({
        kind: "let",
        name: destinationName,
        expression: lowerExpression(final.expression, instructions, context, options),
        location: final.location
      });
    }
    return { kind: "identifier", name: destinationName, location: final.location };
  }

  return destinationName ? { kind: "identifier", name: destinationName, location: definition.body[0]?.location ?? { filename: "<unknown>", line: 1 } } : undefined;
}

function substituteInlineStatements(statements: readonly Statement[], parameters: ReadonlyMap<string, Expression>): readonly Statement[] {
  return statements.map((statement) => substituteInlineStatement(statement, parameters));
}

function substituteInlineStatement(statement: Statement, parameters: ReadonlyMap<string, Expression>): Statement {
  switch (statement.kind) {
    case "const":
      return { ...statement, expression: substituteInlineExpression(statement.expression, parameters) };
    case "dim":
      return { ...statement, dimensions: statement.dimensions.map((dimension) => substituteInlineExpression(dimension, parameters)) };
    case "cls":
      return statement.color ? { ...statement, color: substituteInlineExpression(statement.color, parameters) } : statement;
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
      return { ...statement, color: substituteInlineExpression(statement.color, parameters) };
    case "print":
      return {
        ...statement,
        items: statement.items.map((item) => substituteInlineExpression(item, parameters)),
        ...(statement.at
          ? {
              at: {
                ...statement.at,
                row: substituteInlineExpression(statement.at.row, parameters),
                column: substituteInlineExpression(statement.at.column, parameters)
              }
            }
          : {})
      };
    case "print-device":
      return { ...statement, items: statement.items.map((item) => substituteInlineExpression(item, parameters)) };
    case "let":
      return { ...statement, expression: substituteInlineExpression(statement.expression, parameters) };
      case "array-let":
        return {
          ...statement,
          indices: statement.indices.map((index) => substituteInlineExpression(index, parameters)),
          expression: substituteInlineExpression(statement.expression, parameters)
        };
    case "struct-field-let":
      return {
        ...statement,
        indices: statement.indices.map((index) => substituteInlineExpression(index, parameters)),
        expression: substituteInlineExpression(statement.expression, parameters)
      };
    case "function-call-statement":
      return {
        ...statement,
        expression: { ...statement.expression, args: statement.expression.args.map((arg) => substituteInlineExpression(arg, parameters)) }
      };
    case "insert-element":
      return {
        ...statement,
        target: substituteInlineExpression(statement.target, parameters),
        index: substituteInlineExpression(statement.index, parameters),
        value: substituteInlineExpression(statement.value, parameters),
        fields: statement.fields?.map((field) => ({ ...field, insertExpression: substituteInlineExpression(field.insertExpression, parameters) }))
      };
    case "remove-element":
      return {
        ...statement,
        target: substituteInlineExpression(statement.target, parameters),
        index: substituteInlineExpression(statement.index, parameters)
      };
    case "return":
      return statement.expression ? { ...statement, expression: substituteInlineExpression(statement.expression, parameters) } : statement;
    case "randomize":
      return statement.seed ? { ...statement, seed: substituteInlineExpression(statement.seed, parameters) } : statement;
    case "for":
      return {
        ...statement,
        start: substituteInlineExpression(statement.start, parameters),
        limit: substituteInlineExpression(statement.limit, parameters),
        ...(statement.step ? { step: substituteInlineExpression(statement.step, parameters) } : {}),
        body: substituteInlineStatements(statement.body, parameters)
      };
    case "while":
      return { ...statement, condition: substituteInlineExpression(statement.condition, parameters), body: substituteInlineStatements(statement.body, parameters) };
    case "repeat-until":
      return { ...statement, body: substituteInlineStatements(statement.body, parameters), condition: substituteInlineExpression(statement.condition, parameters) };
    case "if":
      return {
        ...statement,
        condition: substituteInlineExpression(statement.condition, parameters),
        thenBranch: substituteInlineStatements(statement.thenBranch, parameters),
        elseBranch: substituteInlineStatements(statement.elseBranch, parameters)
      };
    case "data":
      return { ...statement, values: statement.values.map((value) => substituteInlineExpression(value, parameters)) };
    case "struct":
    case "comment":
      return statement;
    case "label":
    case "open-device":
    case "close-device":
    case "read":
    case "suppress-scroll-prompt":
    case "program-mode":
    case "restore":
    case "goto":
    case "gosub":
    case "end":
    case "local":
    case "function":
    case "test":
    case "globals":
    case "enum":
    case "exit-for":
    case "continue-for":
    case "assert-true":
    case "assert-false":
    case "assert-eq":
    case "assert-ne":
    case "assert-print":
    case "assert-printat":
    case "assert-screen-border-color":
    case "assert-screen-background-color":
    case "assert-screen-text-color":
    case "assert-cell-text-color":
    case "assert-cell-background-color":
      return statement;
  }
}

function substituteInlineExpression(expression: Expression, parameters: ReadonlyMap<string, Expression>): Expression {
  switch (expression.kind) {
    case "identifier":
      return parameters.get(normalizeName(expression.name)) ?? expression;
    case "array-access":
      return { ...expression, indices: expression.indices.map((index) => substituteInlineExpression(index, parameters)) };
    case "struct-field-access":
      return { ...expression, indices: expression.indices.map((index) => substituteInlineExpression(index, parameters)) };
    case "function-call":
      return { ...expression, args: expression.args.map((arg) => substituteInlineExpression(arg, parameters)) };
    case "parenthesized":
      return { ...expression, expression: substituteInlineExpression(expression.expression, parameters) };
    case "unary":
      return { ...expression, operand: substituteInlineExpression(expression.operand, parameters) };
    case "binary":
      return { ...expression, left: substituteInlineExpression(expression.left, parameters), right: substituteInlineExpression(expression.right, parameters) };
    case "number":
    case "string":
    case "boolean":
    case "color":
      return expression;
  }
}

type ForLoopStaticBehavior = "runs" | "skips" | "unknown";

function forLoopStaticBehavior(start: Expression, limit: Expression, step: Expression | undefined): ForLoopStaticBehavior {
  if (start.kind !== "number" || limit.kind !== "number" || (step && step.kind !== "number")) {
    return "unknown";
  }

  const stepValue = step?.value ?? 1;
  if (stepValue >= 0) {
    return start.value > limit.value ? "skips" : "runs";
  }
  return start.value < limit.value ? "skips" : "runs";
}

function forLoopSkipCondition(start: Expression, limit: Expression, step: Expression | undefined, location: SourceLocation): Expression {
  if (!step) {
    return binaryExpression(">", start, limit, location);
  }

  if (step.kind === "number") {
    return step.value >= 0 ? binaryExpression(">", start, limit, location) : binaryExpression("<", start, limit, location);
  }

  return binaryExpression(
    "OR",
    binaryExpression("AND", binaryExpression(">=", step, numberExpression(0, location), location), binaryExpression(">", start, limit, location), location),
    binaryExpression("AND", binaryExpression("<", step, numberExpression(0, location), location), binaryExpression("<", start, limit, location), location),
    location
  );
}

function numberExpression(value: number, location: SourceLocation): Expression {
  return { kind: "number", value, raw: value.toString(), location };
}

function colorNumber(color: Extract<Expression, { kind: "color" }>): number {
  switch (color.color) {
    case "BLACK":
      return 0;
    case "BLUE":
      return 1;
    case "RED":
      return 2;
    case "MAGENTA":
      return 3;
    case "GREEN":
      return 4;
    case "CYAN":
      return 5;
    case "YELLOW":
      return 6;
    case "WHITE":
      return 7;
  }
}

function stringExpression(value: string, location: SourceLocation): Expression {
  return { kind: "string", value, location };
}

function identifierExpression(name: string, location: SourceLocation): Expression {
  return { kind: "identifier", name, location };
}

function binaryExpression(operator: Extract<Expression, { kind: "binary" }>["operator"], left: Expression, right: Expression, location: SourceLocation): Expression {
  return { kind: "binary", operator, left, right, location };
}

function collectUserLabels(statements: readonly Statement[], seen = new Map<string, SourceLocation>()): ReadonlySet<string> {
  for (const statement of statements) {
    if (statement.kind === "label") {
      const key = normalizeLabel(statement.name);
      const existing = seen.get(key);
      if (existing) {
        throw new DiagnosticError(statement.location, `Duplicate label "${statement.name}" first defined at ${existing.filename}:${existing.line}.`);
      }
      seen.set(key, statement.location);
      continue;
    }

    if (statement.kind === "if") {
      collectUserLabels(statement.thenBranch, seen);
      collectUserLabels(statement.elseBranch, seen);
    } else if (statement.kind === "for") {
      collectUserLabels(statement.body, seen);
    } else if (statement.kind === "while" || statement.kind === "repeat-until") {
      collectUserLabels(statement.body, seen);
    } else if (statement.kind === "function" || statement.kind === "test") {
      collectUserLabels(statement.body, seen);
    } else if (statement.kind === "globals") {
      collectUserLabels(statement.body, seen);
    }
  }

  return new Set(seen.keys());
}

function buildLabelMap(instructions: readonly Instruction[]): ReadonlyMap<string, LabelDefinition> {
  const labels = new Map<string, LabelDefinition>();

  instructions.forEach((instruction, index) => {
    if (instruction.kind !== "label") {
      return;
    }

    const key = normalizeLabel(instruction.name);
    if (labels.has(key)) {
      throw new DiagnosticError(instruction.location, `Duplicate label "${instruction.name}".`);
    }

    labels.set(key, {
      name: instruction.name,
      index,
      location: instruction.location,
      internal: instruction.internal
    });
  });

  return labels;
}

function validateReferences(instructions: readonly Instruction[], labels: ReadonlyMap<string, LabelDefinition>): void {
  for (const instruction of instructions) {
    if (instruction.kind !== "goto" && instruction.kind !== "gosub" && instruction.kind !== "if-goto") {
      continue;
    }

    if (!labels.has(normalizeLabel(instruction.label))) {
      throw new DiagnosticError(instruction.location, `Undefined label "${instruction.label}".`);
    }
  }
}

function internalLabelGenerator(userLabels: ReadonlySet<string>): () => string {
  let nextId = 1;
  const used = new Set(userLabels);

  return () => {
    while (true) {
      const candidate = `__mb_${nextId}`;
      nextId += 1;
      const key = normalizeLabel(candidate);
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
    }
  };
}

export function normalizeLabel(label: string): string {
  return normalizeName(label);
}
