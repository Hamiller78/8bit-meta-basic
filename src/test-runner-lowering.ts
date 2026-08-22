import type { Expression, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { expandFunctionCalls, type FunctionCallLoweringContext } from "./function-call-lowering.js";
import type { Instruction } from "./lowering.js";
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

export function lowerTestRunner(testStatements: readonly Extract<Statement, { kind: "test" }>[], instructions: Instruction[], nextInternalLabel: () => string): void {
  const location = testStatements[0]?.location ?? { filename: "<test runner>", line: 1 };

  instructions.push({ kind: "print", items: [stringExpression("META CONTROL PROGRAM (M.C.P.) RUN STARTED", location)], trailingSemicolon: false, location });
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
    instructions.push({ kind: "let", name: testOutputName, expression: stringExpression("", test.location), location: test.location });
    instructions.push({ kind: "let", name: testPrintAtOutputName, expression: stringExpression("", test.location), location: test.location });
    instructions.push({ kind: "let", name: testPrintAtRowName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testPrintAtColumnName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testScreenBorderColorName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testScreenBackgroundColorName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testScreenTextColorName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testCellTextColorName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testCellBackgroundColorName, expression: numberExpression(-1, test.location), location: test.location });
    instructions.push({ kind: "let", name: testStartFailuresName, expression: identifierExpression(assertionFailedName, test.location), location: test.location });
    instructions.push({ kind: "print", items: [stringExpression(`RUNNING ${test.name}...`, test.location)], trailingSemicolon: true, location: test.location });
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
    instructions.push({ kind: "print", items: [stringExpression("FAILED", test.location)], trailingSemicolon: false, location: test.location });
    instructions.push({ kind: "goto", label: afterLabel, location: test.location });
    instructions.push({ kind: "label", name: passedLabel, internal: true, location: test.location });
    instructions.push({ kind: "print", items: [stringExpression("PASSED", test.location)], trailingSemicolon: false, location: test.location });
    instructions.push({
      kind: "let",
      name: testPassedName,
      expression: binaryExpression("+", identifierExpression(testPassedName, test.location), numberExpression(1, test.location), test.location),
      location: test.location
    });
    instructions.push({ kind: "label", name: afterLabel, internal: true, location: test.location });
  }

  emitFailureBorder(instructions, nextInternalLabel, location);
  instructions.push({ kind: "print", items: [stringExpression("META CONTROL PROGRAM (M.C.P.) RUN FINISHED", location)], trailingSemicolon: false, location });
  instructions.push({ kind: "print", items: [stringExpression("TESTS: ", location), identifierExpression(testCountName, location)], trailingSemicolon: false, location });
  instructions.push({ kind: "print", items: [stringExpression("PASSED: ", location), identifierExpression(testPassedName, location)], trailingSemicolon: false, location });
  instructions.push({ kind: "print", items: [stringExpression("FAILED: ", location), identifierExpression(testFailedName, location)], trailingSemicolon: false, location });
  instructions.push({ kind: "print", items: [stringExpression("ASSERTIONS: ", location), identifierExpression(assertionCountName, location)], trailingSemicolon: false, location });
  instructions.push({ kind: "print", items: [stringExpression("FAILURES: ", location), identifierExpression(assertionFailedName, location)], trailingSemicolon: false, location });
  emitFailedTestSummary(testStatements, instructions, nextInternalLabel, location);
  instructions.push({ kind: "end", location });
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
  incrementAssertionCount(instructions, location);
  const failLabel = nextInternalLabel();
  const endLabel = nextInternalLabel();
  const condition = expandFunctionCalls(expression, instructions, context);
  if (expectedTruth) {
    instructions.push({ kind: "if-goto", condition, label: endLabel, location });
    emitAssertionFailure(instructions, testName, "ASSERT_TRUE", location);
    instructions.push({ kind: "goto", label: endLabel, location });
  } else {
    instructions.push({ kind: "if-goto", condition, label: failLabel, location });
    instructions.push({ kind: "goto", label: endLabel, location });
    instructions.push({ kind: "label", name: failLabel, internal: true, location });
    emitAssertionFailure(instructions, testName, "ASSERT_FALSE", location);
  }
  instructions.push({ kind: "label", name: endLabel, internal: true, location });
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
  incrementAssertionCount(instructions, location);
  const expectedValue = preserveAssertionValue(expandFunctionCalls(expected, instructions, context), expectedValueName, instructions, location);
  const actualValue = preserveAssertionValue(expandFunctionCalls(actual, instructions, context), actualValueName, instructions, location);
  const successLabel = nextInternalLabel();
  const endLabel = nextInternalLabel();
  const operator = kind === "assert-eq" ? "=" : "<>";
  instructions.push({ kind: "if-goto", condition: binaryExpression(operator, expectedValue, actualValue, location), label: successLabel, location });
  emitAssertionFailure(instructions, testName, kind === "assert-eq" ? "ASSERT_EQ" : "ASSERT_NE", location, expectedValue, actualValue);
  instructions.push({ kind: "goto", label: endLabel, location });
  instructions.push({ kind: "label", name: successLabel, internal: true, location });
  instructions.push({ kind: "label", name: endLabel, internal: true, location });
}

export function lowerAssertPrint(
  expected: Expression,
  testName: string | undefined,
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  location: SourceLocation
): void {
  incrementAssertionCount(instructions, location);
  const expectedValue = preserveAssertionValue(expandFunctionCalls(expected, instructions, context), expectedValueName, instructions, location);
  const actualValue = identifierExpression(testOutputName, location);
  const successLabel = nextInternalLabel();
  const endLabel = nextInternalLabel();
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", expectedValue, actualValue, location), label: successLabel, location });
  emitAssertionFailure(instructions, testName, "ASSERT_PRINT", location, expectedValue, actualValue);
  instructions.push({ kind: "goto", label: endLabel, location });
  instructions.push({ kind: "label", name: successLabel, internal: true, location });
  instructions.push({ kind: "label", name: endLabel, internal: true, location });
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
  incrementAssertionCount(instructions, location);
  const rowValue = preserveAssertionValue(expandFunctionCalls(expectedRow, instructions, context), expectedRowName, instructions, location);
  const columnValue = preserveAssertionValue(expandFunctionCalls(expectedColumn, instructions, context), expectedColumnName, instructions, location);
  const textValue = preserveAssertionValue(expandFunctionCalls(expectedText, instructions, context), expectedTextName, instructions, location);
  const rowOkLabel = nextInternalLabel();
  const columnOkLabel = nextInternalLabel();
  const textOkLabel = nextInternalLabel();
  const successLabel = nextInternalLabel();
  const endLabel = nextInternalLabel();
  instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(1, location), location });
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", rowValue, identifierExpression(testPrintAtRowName, location), location), label: rowOkLabel, location });
  instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(0, location), location });
  instructions.push({ kind: "label", name: rowOkLabel, internal: true, location });
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", columnValue, identifierExpression(testPrintAtColumnName, location), location), label: columnOkLabel, location });
  instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(0, location), location });
  instructions.push({ kind: "label", name: columnOkLabel, internal: true, location });
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", textValue, identifierExpression(testPrintAtOutputName, location), location), label: textOkLabel, location });
  instructions.push({ kind: "let", name: testAssertOkName, expression: numberExpression(0, location), location });
  instructions.push({ kind: "label", name: textOkLabel, internal: true, location });
  instructions.push({ kind: "if-goto", condition: identifierExpression(testAssertOkName, location), label: successLabel, location });
  emitAssertionFailure(instructions, testName, "ASSERT_PRINTAT", location);
  instructions.push({ kind: "goto", label: endLabel, location });
  instructions.push({ kind: "label", name: successLabel, internal: true, location });
  instructions.push({ kind: "label", name: endLabel, internal: true, location });
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
  incrementAssertionCount(instructions, location);
  const expectedValue = numberExpression(colorNumber(expected), location);
  const actualValue = identifierExpression(stateName, location);
  const successLabel = nextInternalLabel();
  const endLabel = nextInternalLabel();
  instructions.push({ kind: "if-goto", condition: binaryExpression("=", expectedValue, actualValue, location), label: successLabel, location });
  emitAssertionFailure(instructions, testName, assertionName, location, expectedValue, actualValue);
  instructions.push({ kind: "goto", label: endLabel, location });
  instructions.push({ kind: "label", name: successLabel, internal: true, location });
  instructions.push({ kind: "label", name: endLabel, internal: true, location });
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

function preserveAssertionValue(expression: Expression, baseName: string, instructions: Instruction[], location: SourceLocation): Expression {
  const name = `${baseName}${isStringExpression(expression) ? "$" : ""}`;
  instructions.push({ kind: "let", name, expression, location });
  return identifierExpression(name, location);
}

function emitFailedTestSummary(
  testStatements: readonly Extract<Statement, { kind: "test" }>[],
  instructions: Instruction[],
  nextInternalLabel: () => string,
  location: SourceLocation
): void {
  if (testStatements.length === 0) {
    return;
  }

  const listLabel = nextInternalLabel();
  const doneLabel = nextInternalLabel();
  instructions.push({ kind: "if-goto", condition: identifierExpression(testFailedName, location), label: listLabel, location });
  instructions.push({ kind: "goto", label: doneLabel, location });
  instructions.push({ kind: "label", name: listLabel, internal: true, location });
  instructions.push({ kind: "print", items: [stringExpression("FAILED TESTS:", location)], trailingSemicolon: false, location });

  for (const [index, test] of testStatements.entries()) {
    const printLabel = nextInternalLabel();
    const nextLabel = nextInternalLabel();
    instructions.push({ kind: "if-goto", condition: arrayAccessExpression(failedTestFlagsName, [numberExpression(index, test.location)], test.location), label: printLabel, location: test.location });
    instructions.push({ kind: "goto", label: nextLabel, location: test.location });
    instructions.push({ kind: "label", name: printLabel, internal: true, location: test.location });
    instructions.push({ kind: "print", items: [stringExpression(test.name, test.location)], trailingSemicolon: false, location: test.location });
    instructions.push({ kind: "label", name: nextLabel, internal: true, location: test.location });
  }

  instructions.push({ kind: "label", name: doneLabel, internal: true, location });
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

function binaryExpression(operator: Extract<Expression, { kind: "binary" }>["operator"], left: Expression, right: Expression, location: SourceLocation): Expression {
  return { kind: "binary", operator, left, right, location };
}
