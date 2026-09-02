import type { DeviceKind, Expression, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { expandFunctionCalls, type FunctionCallLoweringContext } from "./function-call-lowering.js";
import { builtinFunctions } from "./functions.js";
import type { Instruction } from "./lowering.js";
import { replaceTestRuntimeFunctionCalls, testJiffiesName, testKeyCodeName, testKeyPressedName } from "./test-runtime.js";
import { isStringVariableName } from "./variables.js";

export const testOutputName = "MBTOUT$";
export const testPrintAtOutputName = "MBTPOUT$";
export const testPrintAtRowName = "MBTPROW";
export const testPrintAtColumnName = "MBTPCOL";
export const testScreenBorderColorName = "MBTCB";
export const testScreenBackgroundColorName = "MBTCG";
export const testScreenTextColorName = "MBTCT";
export const testCellTextColorName = "MBTCC";
export const testCellBackgroundColorName = "MBTCD";
export { testJiffiesName, testKeyCodeName, testKeyPressedName };

const testCountName = "MBTESTS";
const testPassedName = "MBTPASS";
const testFailedName = "MBTFAIL";
const assertionCountName = "MBASSERT";
const assertionFailedName = "MBFAIL";
const testStartFailuresName = "MBTF0";
const failedTestFlagsName = "MBTF";
const testAssertOkName = "MBTAOK";
const expectedValueName = "MBAVEX";
const actualValueName = "MBAVAC";
const expectedRowName = "MBAVR";
const expectedColumnName = "MBAVC";
const expectedTextName = "MBAVT";
const booleanActualName = "MBAB";
const printerAvailableName = "MBTPRN";
const printerHandleName = "MBTPR";
const runnerMessageName = "MBTMSG$";
const assertTrueLabel = "__mb_assert_true";
const assertFalseLabel = "__mb_assert_false";
const assertEqNumberLabel = "__mb_assert_eq_num";
const assertNeNumberLabel = "__mb_assert_ne_num";
const assertEqStringLabel = "__mb_assert_eq_str";
const assertNeStringLabel = "__mb_assert_ne_str";
const assertPrintAtLabel = "__mb_assert_printat";
const runnerPrintLineLabel = "__mb_runner_print_line";
const runnerPrintInlineLabel = "__mb_runner_print_inline";

export interface TestRunnerLowerOptions {
  readonly printerOutput?: boolean;
  readonly outputDevice?: DeviceKind;
  readonly globalResetInstructions?: readonly Instruction[];
}

export function lowerTestRunner(
  testStatements: readonly Extract<Statement, { kind: "test" }>[],
  instructions: Instruction[],
  nextInternalLabel: () => string,
  options: TestRunnerLowerOptions = {}
): void {
  const location = testStatements[0]?.location ?? { filename: "<test runner>", line: 1 };
  const outputDevice = options.outputDevice ?? "printer";
  const assertionHelpers = collectAssertionHelperRequirements(testStatements);

  if (options.printerOutput) {
    openTestDevice(instructions, nextInternalLabel, location, outputDevice);
  }

  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("META CONTROL PROGRAM (M.C.P.) RUN STARTED", location)], false, location, options);
  instructions.push({ kind: "let", name: testCountName, expression: numberExpression(0, location), location });
  instructions.push({ kind: "let", name: testPassedName, expression: numberExpression(0, location), location });
  instructions.push({ kind: "let", name: testFailedName, expression: numberExpression(0, location), location });
  instructions.push({ kind: "let", name: assertionCountName, expression: numberExpression(0, location), location });
  instructions.push({ kind: "let", name: assertionFailedName, expression: numberExpression(0, location), location });
  if (testStatements.length > 0) {
    instructions.push({ kind: "dim-array", name: failedTestFlagsName, dimensions: [testStatements.length], location });
  }

  for (const [index, test] of testStatements.entries()) {
    if (!test.implementation) {
      throw new DiagnosticError(test.location, `Internal error: TEST ${test.name} was not analyzed before lowering.`);
    }
    const passedLabel = nextInternalLabel();
    const afterLabel = nextInternalLabel();
    instructions.push(...testRuntimeResetLets(test.location));
    instructions.push(...testCaptureResetLets(test));
    instructions.push(...cloneInstructions(options.globalResetInstructions ?? []));
    instructions.push({ kind: "let", name: testStartFailuresName, expression: identifierExpression(assertionFailedName, test.location), location: test.location });
    emitRunnerPrint(instructions, nextInternalLabel, [stringExpression(`RUNNING ${test.name}...`, test.location)], true, test.location, options);
    instructions.push({ kind: "gosub", label: test.implementation.entryLabel, location: test.location });
    instructions.push({
      kind: "let",
      name: testCountName,
      expression: binaryExpression("+", identifierExpression(testCountName, test.location), numberExpression(1, test.location), test.location),
      location: test.location
    });
    instructions.push({
      kind: "if-goto",
      condition: binaryExpression("=", identifierExpression(assertionFailedName, test.location), identifierExpression(testStartFailuresName, test.location), test.location),
      label: passedLabel,
      location: test.location
    });
    instructions.push({
      kind: "let",
      name: testFailedName,
      expression: binaryExpression("+", identifierExpression(testFailedName, test.location), numberExpression(1, test.location), test.location),
      location: test.location
    });
    instructions.push({ kind: "array-let", name: failedTestFlagsName, indices: [numberExpression(index, test.location)], expression: numberExpression(1, test.location), location: test.location });
    emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("FAILED", test.location)], false, test.location, options);
    instructions.push({ kind: "goto", label: afterLabel, location: test.location });
    instructions.push({ kind: "label", name: passedLabel, internal: true, location: test.location });
    emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("PASSED", test.location)], false, test.location, options);
    instructions.push({
      kind: "let",
      name: testPassedName,
      expression: binaryExpression("+", identifierExpression(testPassedName, test.location), numberExpression(1, test.location), test.location),
      location: test.location
    });
    instructions.push({ kind: "label", name: afterLabel, internal: true, location: test.location });
  }

  emitFailureBorder(instructions, nextInternalLabel, location);
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("META CONTROL PROGRAM (M.C.P.) RUN FINISHED", location)], false, location, options);
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("TESTS: ", location), identifierExpression(testCountName, location)], false, location, options);
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("PASSED: ", location), identifierExpression(testPassedName, location)], false, location, options);
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("FAILED: ", location), identifierExpression(testFailedName, location)], false, location, options);
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("ASSERTIONS: ", location), identifierExpression(assertionCountName, location)], false, location, options);
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("FAILURES: ", location), identifierExpression(assertionFailedName, location)], false, location, options);
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("FREE MEMORY: ", location), freeMemoryExpression(location)], false, location, options);
  emitFailedTestSummary(testStatements, instructions, nextInternalLabel, location, options);
  if (options.printerOutput) {
    closeTestDevice(instructions, nextInternalLabel, location);
    emitRunnerPrintHelpers(instructions, nextInternalLabel, location);
  }
  emitAssertionHelpers(instructions, location, assertionHelpers);
  instructions.push({ kind: "end", location });
}

function cloneInstructions(instructions: readonly Instruction[]): Instruction[] {
  return instructions.map((instruction) => ({ ...instruction }));
}

function testRuntimeResetLets(location: SourceLocation): Instruction[] {
  return [
    { kind: "let", name: testJiffiesName, expression: numberExpression(0, location), location },
    { kind: "let", name: testKeyCodeName, expression: numberExpression(0, location), location },
    { kind: "let", name: testKeyPressedName, expression: numberExpression(0, location), location }
  ];
}

function lowerTestExpression(expression: Expression, instructions: Instruction[], context: FunctionCallLoweringContext): Expression {
  return replaceTestRuntimeFunctionCalls(expandFunctionCalls(expression, instructions, context));
}

export function lowerAssertBoolean(
  expression: Expression,
  expectedTruth: boolean,
  testName: string | undefined,
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  location: SourceLocation
): void {
  const condition = lowerTestExpression(expression, instructions, context);
  instructions.push({ kind: "let", name: booleanActualName, expression: condition, location });
  instructions.push({ kind: "gosub", label: expectedTruth ? assertTrueLabel : assertFalseLabel, location });
}

export function lowerAssertComparison(
  kind: "assert-eq" | "assert-ne",
  expected: Expression,
  actual: Expression,
  testName: string | undefined,
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  location: SourceLocation
): void {
  const stringComparison = isStringExpression(expected) || isStringExpression(actual);
  preserveAssertionValue(lowerTestExpression(expected, instructions, context), expectedValueName, instructions, location);
  preserveAssertionValue(lowerTestExpression(actual, instructions, context), actualValueName, instructions, location);
  void testName;
  instructions.push({
    kind: "gosub",
    label: stringComparison
      ? kind === "assert-eq"
        ? assertEqStringLabel
        : assertNeStringLabel
      : kind === "assert-eq"
        ? assertEqNumberLabel
        : assertNeNumberLabel,
    location
  });
}

export function lowerAssertPrint(
  expected: Expression,
  testName: string | undefined,
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  location: SourceLocation
): void {
  preserveAssertionValue(lowerTestExpression(expected, instructions, context), expectedValueName, instructions, location);
  instructions.push({ kind: "let", name: `${actualValueName}$`, expression: identifierExpression(testOutputName, location), location });
  void testName;
  instructions.push({ kind: "gosub", label: assertEqStringLabel, location });
}

export function lowerAssertPrintAt(
  expectedRow: Expression,
  expectedColumn: Expression,
  expectedText: Expression,
  testName: string | undefined,
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  location: SourceLocation
): void {
  preserveAssertionValue(lowerTestExpression(expectedRow, instructions, context), expectedRowName, instructions, location);
  preserveAssertionValue(lowerTestExpression(expectedColumn, instructions, context), expectedColumnName, instructions, location);
  preserveAssertionValue(lowerTestExpression(expectedText, instructions, context), expectedTextName, instructions, location);
  void testName;
  instructions.push({ kind: "gosub", label: assertPrintAtLabel, location });
}

export function lowerAssertColor(
  assertionName: string,
  stateName: string,
  expected: Expression,
  testName: string | undefined,
  instructions: Instruction[],
  nextInternalLabel: () => string,
  location: SourceLocation
): void {
  if (expected.kind !== "color") {
    throw new DiagnosticError(location, `Internal error: ${assertionName} expected colour was not resolved before lowering.`);
  }
  instructions.push({ kind: "let", name: expectedValueName, expression: numberExpression(colorNumber(expected), location), location });
  instructions.push({ kind: "let", name: actualValueName, expression: identifierExpression(stateName, location), location });
  instructions.push({ kind: "gosub", label: assertEqNumberLabel, location });
  void assertionName;
  void testName;
}

export function capturedPrintExpression(items: readonly Expression[], location: SourceLocation): Expression {
  if (items.length === 0) {
    return stringExpression("", location);
  }
  return items.map((item) => stringCaptureExpression(item, location)).reduce((left, right) => binaryExpression("+", left, right, location));
}

export function captureTestColor(instructions: Instruction[], name: string, color: Extract<Expression, { kind: "color" }>, location: SourceLocation): void {
  instructions.push({ kind: "let", name, expression: numberExpression(colorNumber(color), location), location });
}

function incrementAssertionCount(instructions: Instruction[], location: SourceLocation): void {
  instructions.push({
    kind: "let",
    name: assertionCountName,
    expression: binaryExpression("+", identifierExpression(assertionCountName, location), numberExpression(1, location), location),
    location
  });
}

function emitAssertionFailure(
  instructions: Instruction[],
  testName: string | undefined,
  assertionName: string,
  location: SourceLocation,
  expected?: Expression,
  actual?: Expression
): void {
  void testName;
  void assertionName;
  void expected;
  void actual;
  instructions.push({
    kind: "let",
    name: assertionFailedName,
    expression: binaryExpression("+", identifierExpression(assertionFailedName, location), numberExpression(1, location), location),
    location
  });
}

function emitAssertionHelpers(instructions: Instruction[], location: SourceLocation, requirements: AssertionHelperRequirements): void {
  if (!hasAssertionHelperRequirements(requirements)) {
    return;
  }

  const afterHelpersLabel = "__mb_assert_helpers_done";
  const assertTrueOkLabel = "__mb_assert_true_ok";
  const assertFalseFailLabel = "__mb_assert_false_fail";
  const assertFalseDoneLabel = "__mb_assert_false_done";
  const assertEqNumberOkLabel = "__mb_assert_eq_num_ok";
  const assertNeNumberOkLabel = "__mb_assert_ne_num_ok";
  const assertEqStringOkLabel = "__mb_assert_eq_str_ok";
  const assertNeStringOkLabel = "__mb_assert_ne_str_ok";
  const assertPrintAtRowOkLabel = "__mb_assert_printat_row_ok";
  const assertPrintAtColumnOkLabel = "__mb_assert_printat_column_ok";
  const assertPrintAtTextOkLabel = "__mb_assert_printat_text_ok";
  const assertPrintAtOkLabel = "__mb_assert_printat_ok";

  instructions.push({ kind: "goto", label: afterHelpersLabel, location });

  if (requirements.assertTrue) {
    instructions.push({ kind: "label", name: assertTrueLabel, internal: true, location });
    incrementAssertionCount(instructions, location);
    instructions.push({ kind: "if-goto", condition: identifierExpression(booleanActualName, location), label: assertTrueOkLabel, location });
    emitAssertionFailure(instructions, undefined, "ASSERT_TRUE", location);
    instructions.push({ kind: "label", name: assertTrueOkLabel, internal: true, location });
    instructions.push({ kind: "return", location });
  }

  if (requirements.assertFalse) {
    instructions.push({ kind: "label", name: assertFalseLabel, internal: true, location });
    incrementAssertionCount(instructions, location);
    instructions.push({ kind: "if-goto", condition: identifierExpression(booleanActualName, location), label: assertFalseFailLabel, location });
    instructions.push({ kind: "goto", label: assertFalseDoneLabel, location });
    instructions.push({ kind: "label", name: assertFalseFailLabel, internal: true, location });
    emitAssertionFailure(instructions, undefined, "ASSERT_FALSE", location);
    instructions.push({ kind: "label", name: assertFalseDoneLabel, internal: true, location });
    instructions.push({ kind: "return", location });
  }

  if (requirements.assertEqNumber) {
    instructions.push({ kind: "label", name: assertEqNumberLabel, internal: true, location });
    incrementAssertionCount(instructions, location);
    instructions.push({
      kind: "if-goto",
      condition: binaryExpression("=", identifierExpression(expectedValueName, location), identifierExpression(actualValueName, location), location),
      label: assertEqNumberOkLabel,
      location
    });
    emitAssertionFailure(instructions, undefined, "ASSERT_EQ", location);
    instructions.push({ kind: "label", name: assertEqNumberOkLabel, internal: true, location });
    instructions.push({ kind: "return", location });
  }

  if (requirements.assertNeNumber) {
    instructions.push({ kind: "label", name: assertNeNumberLabel, internal: true, location });
    incrementAssertionCount(instructions, location);
    instructions.push({
      kind: "if-goto",
      condition: binaryExpression("<>", identifierExpression(expectedValueName, location), identifierExpression(actualValueName, location), location),
      label: assertNeNumberOkLabel,
      location
    });
    emitAssertionFailure(instructions, undefined, "ASSERT_NE", location);
    instructions.push({ kind: "label", name: assertNeNumberOkLabel, internal: true, location });
    instructions.push({ kind: "return", location });
  }

  if (requirements.assertEqString) {
    instructions.push({ kind: "label", name: assertEqStringLabel, internal: true, location });
    incrementAssertionCount(instructions, location);
    instructions.push({
      kind: "if-goto",
      condition: binaryExpression("=", identifierExpression(`${expectedValueName}$`, location), identifierExpression(`${actualValueName}$`, location), location),
      label: assertEqStringOkLabel,
      location
    });
    emitAssertionFailure(instructions, undefined, "ASSERT_EQ", location);
    instructions.push({ kind: "label", name: assertEqStringOkLabel, internal: true, location });
    instructions.push({ kind: "return", location });
  }

  if (requirements.assertNeString) {
    instructions.push({ kind: "label", name: assertNeStringLabel, internal: true, location });
    incrementAssertionCount(instructions, location);
    instructions.push({
      kind: "if-goto",
      condition: binaryExpression("<>", identifierExpression(`${expectedValueName}$`, location), identifierExpression(`${actualValueName}$`, location), location),
      label: assertNeStringOkLabel,
      location
    });
    emitAssertionFailure(instructions, undefined, "ASSERT_NE", location);
    instructions.push({ kind: "label", name: assertNeStringOkLabel, internal: true, location });
    instructions.push({ kind: "return", location });
  }

  if (requirements.assertPrintAt) {
    instructions.push({ kind: "label", name: assertPrintAtLabel, internal: true, location });
    incrementAssertionCount(instructions, location);
    instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(1, location), location });
    instructions.push({ kind: "if-goto", condition: binaryExpression("=", identifierExpression(expectedRowName, location), identifierExpression(testPrintAtRowName, location), location), label: assertPrintAtRowOkLabel, location });
    instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(0, location), location });
    instructions.push({ kind: "label", name: assertPrintAtRowOkLabel, internal: true, location });
    instructions.push({ kind: "if-goto", condition: binaryExpression("=", identifierExpression(expectedColumnName, location), identifierExpression(testPrintAtColumnName, location), location), label: assertPrintAtColumnOkLabel, location });
    instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(0, location), location });
    instructions.push({ kind: "label", name: assertPrintAtColumnOkLabel, internal: true, location });
    instructions.push({ kind: "if-goto", condition: binaryExpression("=", identifierExpression(`${expectedTextName}$`, location), identifierExpression(testPrintAtOutputName, location), location), label: assertPrintAtTextOkLabel, location });
    instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(0, location), location });
    instructions.push({ kind: "label", name: assertPrintAtTextOkLabel, internal: true, location });
    instructions.push({ kind: "if-goto", condition: identifierExpression(testAssertOkName, location), label: assertPrintAtOkLabel, location });
    emitAssertionFailure(instructions, undefined, "ASSERT_PRINTAT", location);
    instructions.push({ kind: "label", name: assertPrintAtOkLabel, internal: true, location });
    instructions.push({ kind: "return", location });
  }

  instructions.push({ kind: "label", name: afterHelpersLabel, internal: true, location });
}

function preserveAssertionValue(expression: Expression, baseName: string, instructions: Instruction[], location: SourceLocation): Expression {
  const name = `${baseName}${isStringExpression(expression) ? "$" : ""}`;
  instructions.push({ kind: "let", name, expression, location });
  return identifierExpression(name, location);
}

function emitFailedTestSummary(
  testStatements: readonly Extract<Statement, { kind: "test" }>[],
  instructions: Instruction[],
  nextInternalLabel: () => string,
  location: SourceLocation,
  options: TestRunnerLowerOptions = {}
): void {
  if (testStatements.length === 0) {
    return;
  }

  const listLabel = nextInternalLabel();
  const doneLabel = nextInternalLabel();
  instructions.push({ kind: "if-goto", condition: identifierExpression(testFailedName, location), label: listLabel, location });
  instructions.push({ kind: "goto", label: doneLabel, location });
  instructions.push({ kind: "label", name: listLabel, internal: true, location });
  emitRunnerPrint(instructions, nextInternalLabel, [stringExpression("FAILED TESTS:", location)], false, location, options);

  for (const [index, test] of testStatements.entries()) {
    const printLabel = nextInternalLabel();
    const nextLabel = nextInternalLabel();
    instructions.push({ kind: "if-goto", condition: arrayAccessExpression(failedTestFlagsName, [numberExpression(index, test.location)], test.location), label: printLabel, location: test.location });
    instructions.push({ kind: "goto", label: nextLabel, location: test.location });
    instructions.push({ kind: "label", name: printLabel, internal: true, location: test.location });
    emitRunnerPrint(instructions, nextInternalLabel, [stringExpression(test.name, test.location)], false, test.location, options);
    instructions.push({ kind: "label", name: nextLabel, internal: true, location: test.location });
  }

  instructions.push({ kind: "label", name: doneLabel, internal: true, location });
}

function testCaptureResetLets(test: Extract<Statement, { kind: "test" }>): Instruction[] {
  const state = collectAssertedCaptureState(test.body);
  const instructions: Instruction[] = [];
  if (state.print) {
    instructions.push({ kind: "let", name: testOutputName, expression: stringExpression("", test.location), location: test.location });
  }
  if (state.printAt) {
    instructions.push({ kind: "let", name: testPrintAtOutputName, expression: stringExpression("", test.location), location: test.location });
    instructions.push({ kind: "let", name: testPrintAtRowName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testPrintAtColumnName, expression: numberExpression(-1, test.location), location: test.location });
  }
  if (state.screenBorderColor) {
    instructions.push({ kind: "let", name: testScreenBorderColorName, expression: numberExpression(-1, test.location), location: test.location });
  }
  if (state.screenBackgroundColor) {
    instructions.push({ kind: "let", name: testScreenBackgroundColorName, expression: numberExpression(-1, test.location), location: test.location });
  }
  if (state.screenTextColor) {
    instructions.push({ kind: "let", name: testScreenTextColorName, expression: numberExpression(-1, test.location), location: test.location });
  }
  if (state.cellTextColor) {
    instructions.push({ kind: "let", name: testCellTextColorName, expression: numberExpression(-1, test.location), location: test.location });
  }
  if (state.cellBackgroundColor) {
    instructions.push({ kind: "let", name: testCellBackgroundColorName, expression: numberExpression(-1, test.location), location: test.location });
  }
  return instructions;
}

interface AssertedCaptureState {
  print: boolean;
  printAt: boolean;
  screenBorderColor: boolean;
  screenBackgroundColor: boolean;
  screenTextColor: boolean;
  cellTextColor: boolean;
  cellBackgroundColor: boolean;
}

interface AssertionHelperRequirements {
  assertTrue: boolean;
  assertFalse: boolean;
  assertEqNumber: boolean;
  assertNeNumber: boolean;
  assertEqString: boolean;
  assertNeString: boolean;
  assertPrintAt: boolean;
}

function collectAssertionHelperRequirements(testStatements: readonly Extract<Statement, { kind: "test" }>[]): AssertionHelperRequirements {
  const requirements = emptyAssertionHelperRequirements();
  for (const test of testStatements) {
    collectStatementAssertionHelperRequirements(test.body, requirements);
  }
  return requirements;
}

function collectStatementAssertionHelperRequirements(statements: readonly Statement[], requirements: AssertionHelperRequirements): AssertionHelperRequirements {
  for (const statement of statements) {
    switch (statement.kind) {
      case "assert-true":
        requirements.assertTrue = true;
        break;
      case "assert-false":
        requirements.assertFalse = true;
        break;
      case "assert-eq":
        if (!statement.expected) {
          throw new DiagnosticError(statement.location, "Internal error: ASSERT_EQ missing expected expression before lowering.");
        }
        if (isStringExpression(statement.expected) || isStringExpression(statement.actual)) {
          requirements.assertEqString = true;
        } else {
          requirements.assertEqNumber = true;
        }
        break;
      case "assert-ne":
        if (!statement.expected) {
          throw new DiagnosticError(statement.location, "Internal error: ASSERT_NE missing expected expression before lowering.");
        }
        if (isStringExpression(statement.expected) || isStringExpression(statement.actual)) {
          requirements.assertNeString = true;
        } else {
          requirements.assertNeNumber = true;
        }
        break;
      case "assert-print":
        requirements.assertEqString = true;
        break;
      case "assert-printat":
        requirements.assertPrintAt = true;
        break;
      case "assert-screen-border-color":
      case "assert-screen-background-color":
      case "assert-screen-text-color":
      case "assert-cell-text-color":
      case "assert-cell-background-color":
        requirements.assertEqNumber = true;
        break;
      case "if":
        collectStatementAssertionHelperRequirements(statement.thenBranch, requirements);
        collectStatementAssertionHelperRequirements(statement.elseBranch, requirements);
        break;
      case "for":
      case "while":
      case "repeat-until":
        collectStatementAssertionHelperRequirements(statement.body, requirements);
        break;
    }
  }
  return requirements;
}

function emptyAssertionHelperRequirements(): AssertionHelperRequirements {
  return {
    assertTrue: false,
    assertFalse: false,
    assertEqNumber: false,
    assertNeNumber: false,
    assertEqString: false,
    assertNeString: false,
    assertPrintAt: false
  };
}

function hasAssertionHelperRequirements(requirements: AssertionHelperRequirements): boolean {
  return (
    requirements.assertTrue ||
    requirements.assertFalse ||
    requirements.assertEqNumber ||
    requirements.assertNeNumber ||
    requirements.assertEqString ||
    requirements.assertNeString ||
    requirements.assertPrintAt
  );
}

function collectAssertedCaptureState(statements: readonly Statement[], state: AssertedCaptureState = emptyAssertedCaptureState()): AssertedCaptureState {
  for (const statement of statements) {
    switch (statement.kind) {
      case "assert-print":
        state.print = true;
        break;
      case "assert-printat":
        state.printAt = true;
        break;
      case "assert-screen-border-color":
        state.screenBorderColor = true;
        break;
      case "assert-screen-background-color":
        state.screenBackgroundColor = true;
        break;
      case "assert-screen-text-color":
        state.screenTextColor = true;
        break;
      case "assert-cell-text-color":
        state.cellTextColor = true;
        break;
      case "assert-cell-background-color":
        state.cellBackgroundColor = true;
        break;
      case "if":
        collectAssertedCaptureState(statement.thenBranch, state);
        collectAssertedCaptureState(statement.elseBranch, state);
        break;
      case "for":
      case "while":
      case "repeat-until":
        collectAssertedCaptureState(statement.body, state);
        break;
    }
  }
  return state;
}

function emptyAssertedCaptureState(): AssertedCaptureState {
  return {
    print: false,
    printAt: false,
    screenBorderColor: false,
    screenBackgroundColor: false,
    screenTextColor: false,
    cellTextColor: false,
    cellBackgroundColor: false
  };
}

function openTestDevice(instructions: Instruction[], nextInternalLabel: () => string, location: SourceLocation, device: DeviceKind): void {
  const doneLabel = nextInternalLabel();
  instructions.push({ kind: "check-device", name: printerAvailableName, device, location });
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", identifierExpression(printerAvailableName, location), numberExpression(0, location), location), label: doneLabel, location });
  instructions.push({ kind: "open-device", handle: printerHandleName, device, location });
  instructions.push({ kind: "let", name: printerAvailableName, expression: numberExpression(1, location), location });
  instructions.push({ kind: "label", name: doneLabel, internal: true, location });
}

function closeTestDevice(instructions: Instruction[], nextInternalLabel: () => string, location: SourceLocation): void {
  const doneLabel = nextInternalLabel();
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", identifierExpression(printerAvailableName, location), numberExpression(0, location), location), label: doneLabel, location });
  instructions.push({ kind: "close-device", handle: printerHandleName, location });
  instructions.push({ kind: "label", name: doneLabel, internal: true, location });
}

function emitRunnerPrint(
  instructions: Instruction[],
  nextInternalLabel: () => string,
  items: readonly Expression[],
  trailingSemicolon: boolean,
  location: SourceLocation,
  options: TestRunnerLowerOptions
): void {
  if (!options.printerOutput) {
    instructions.push({ kind: "suppress-scroll-prompt", location });
    instructions.push({ kind: "print", items, trailingSemicolon, location });
    return;
  }

  void nextInternalLabel;
  instructions.push({ kind: "let", name: runnerMessageName, expression: capturedPrintExpression(items, location), location });
  instructions.push({ kind: "gosub", label: trailingSemicolon ? runnerPrintInlineLabel : runnerPrintLineLabel, location });
}

function emitRunnerPrintHelpers(instructions: Instruction[], nextInternalLabel: () => string, location: SourceLocation): void {
  const afterHelpersLabel = nextInternalLabel();
  instructions.push({ kind: "goto", label: afterHelpersLabel, location });
  emitRunnerPrintHelper(instructions, nextInternalLabel, location, runnerPrintLineLabel, false);
  emitRunnerPrintHelper(instructions, nextInternalLabel, location, runnerPrintInlineLabel, true);
  instructions.push({ kind: "label", name: afterHelpersLabel, internal: true, location });
}

function emitRunnerPrintHelper(
  instructions: Instruction[],
  nextInternalLabel: () => string,
  location: SourceLocation,
  label: string,
  trailingSemicolon: boolean
): void {
  const screenLabel = nextInternalLabel();
  instructions.push({ kind: "label", name: label, internal: true, location });
  instructions.push({ kind: "suppress-scroll-prompt", location });
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", identifierExpression(printerAvailableName, location), numberExpression(0, location), location), label: screenLabel, location });
  instructions.push({ kind: "print-device", handle: printerHandleName, items: [identifierExpression(runnerMessageName, location)], trailingSemicolon, location });
  instructions.push({ kind: "label", name: screenLabel, internal: true, location });
  instructions.push({ kind: "print", items: [identifierExpression(runnerMessageName, location)], trailingSemicolon, location });
  instructions.push({ kind: "return", location });
}

function emitFailureBorder(instructions: Instruction[], nextInternalLabel: () => string, location: SourceLocation): void {
  const failedLabel = nextInternalLabel();
  const doneLabel = nextInternalLabel();
  instructions.push({
    kind: "if-goto",
    condition: binaryExpression("<>", identifierExpression(testFailedName, location), numberExpression(0, location), location),
    label: failedLabel,
    location
  });
  instructions.push({ kind: "goto", label: doneLabel, location });
  instructions.push({ kind: "label", name: failedLabel, internal: true, location });
  instructions.push({ kind: "border-color", color: colorExpression("RED", location), location });
  instructions.push({ kind: "label", name: doneLabel, internal: true, location });
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

function stringCaptureExpression(expression: Expression, location: SourceLocation): Expression {
  if (isStringExpression(expression)) {
    return expression;
  }
  return { kind: "function-call", name: "STR$", args: [expression], valueType: "string", location };
}

function isStringExpression(expression: Expression): boolean {
  switch (expression.kind) {
    case "string":
      return true;
    case "identifier":
      return isStringVariableName(expression.name);
    case "array-access":
    case "function-call":
      return expression.valueType === "string" || isStringVariableName(expression.name);
    case "struct-field-access":
      return expression.valueType === "string" || isStringVariableName(expression.field);
    case "parenthesized":
      return isStringExpression(expression.expression);
    case "binary":
      return expression.operator === "+" && isStringExpression(expression.left) && isStringExpression(expression.right);
    case "number":
    case "boolean":
    case "color":
    case "unary":
      return false;
  }
}

function numberExpression(value: number, location: SourceLocation): Expression {
  return { kind: "number", value, raw: value.toString(), location };
}

function stringExpression(value: string, location: SourceLocation): Expression {
  return { kind: "string", value, location };
}

function colorExpression(color: Extract<Expression, { kind: "color" }>["color"], location: SourceLocation): Extract<Expression, { kind: "color" }> {
  return { kind: "color", color, location };
}

function identifierExpression(name: string, location: SourceLocation): Expression {
  return { kind: "identifier", name, location };
}

function arrayAccessExpression(name: string, indices: readonly Expression[], location: SourceLocation): Expression {
  return { kind: "array-access", name, indices, valueType: "number", location };
}

function freeMemoryExpression(location: SourceLocation): Expression {
  return { kind: "function-call", name: builtinFunctions.freeMemory, args: [], valueType: "number", location };
}

function binaryExpression(operator: Extract<Expression, { kind: "binary" }>["operator"], left: Expression, right: Expression, location: SourceLocation): Expression {
  return { kind: "binary", operator, left, right, location };
}
