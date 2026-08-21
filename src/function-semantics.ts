import type { Expression, FunctionImplementation, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { canonicalFunctionName } from "./functions.js";
import { normalizeName } from "./symbols.js";
import { isIntegerVariableName, isStringVariableName } from "./variables.js";

export interface FunctionDefinition {
  readonly name: string;
  readonly key: string;
  readonly valueType: "number" | "string";
  readonly implementation: FunctionImplementation;
  readonly statement: Extract<Statement, { kind: "function" }>;
}

export interface FunctionScope {
  readonly functionName: string;
  readonly returnName: string;
  readonly variables: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string>;
}

export function createFunctionScope(definition: FunctionDefinition): FunctionScope {
  const variables = new Map<string, string>();
  for (const parameter of definition.implementation.parameters) {
    variables.set(normalizeName(parameter.sourceName), parameter.storageName);
  }
  for (const local of definition.implementation.locals) {
    variables.set(normalizeName(local.sourceName), local.storageName);
  }

  const labels = new Map<string, string>();
  collectLabels(definition.statement.body, labels);
  for (const [key, label] of labels) {
    labels.set(key, functionLabelName(definition.implementation.entryLabel, label));
  }

  return {
    functionName: definition.name,
    returnName: definition.implementation.returnName,
    variables,
    labels
  };
}

export function containsFunctionReturn(statements: readonly Statement[]): boolean {
  return statements.some((statement) => {
    if (statement.kind === "return" && statement.expression) {
      return true;
    }
    if (statement.kind === "if") {
      return containsFunctionReturn(statement.thenBranch) || containsFunctionReturn(statement.elseBranch);
    }
    if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      return containsFunctionReturn(statement.body);
    }
    return false;
  });
}

export function collectFunctionDefinitions(statements: readonly Statement[]): ReadonlyMap<string, FunctionDefinition> {
  const functions = new Map<string, FunctionDefinition>();
  let nextId = 1;

  for (const statement of statements) {
    if (statement.kind !== "function") {
      continue;
    }

    const key = normalizeName(statement.name);
    if (canonicalFunctionName(statement.name)) {
      throw new DiagnosticError(statement.location, `Cannot declare FUNCTION "${statement.name}" with the same name as a built-in function.`);
    }
    if (functions.has(key)) {
      throw new DiagnosticError(statement.location, `Duplicate FUNCTION "${statement.name}".`);
    }

    const id = nextId;
    nextId += 1;
    const locals = collectLocalNames(statement);
    validateScopedNames(statement, locals);
    const implementation: FunctionImplementation = {
      entryLabel: `MBF${id}ENTRY`,
      returnName: `MBF${id}R${isStringVariableName(statement.name) ? "$" : ""}`,
      parameters: statement.parameters.map((parameter, index) => ({
        sourceName: parameter,
        storageName: storageName(id, "P", index + 1, parameter)
      })),
      locals: locals.map((local, index) => ({
        sourceName: local,
        storageName: storageName(id, "L", index + 1, local)
      }))
    };

    functions.set(key, {
      name: statement.name,
      key,
      valueType: isStringVariableName(statement.name) ? "string" : "number",
      implementation,
      statement
    });
  }

  return functions;
}

export function validateControlFlowBoundaries(statements: readonly Statement[]): void {
  const topLevelLabels = collectLabels(statements.filter((statement) => statement.kind !== "function"));
  const functionLabelSets = statements
    .filter((statement): statement is Extract<Statement, { kind: "function" }> => statement.kind === "function")
    .map((statement) => collectLabels(statement.body));
  const allFunctionLabels = mergeLabelSets(functionLabelSets);
  validateLabelReferences(statements.filter((statement) => statement.kind !== "function"), topLevelLabels, allFunctionLabels);

  for (const statement of statements) {
    if (statement.kind !== "function") {
      continue;
    }
    const functionLabels = collectLabels(statement.body);
    const forbiddenLabels = mergeLabelSets([topLevelLabels, ...functionLabelSets.filter((labels) => labels !== functionLabels)]);
    validateLabelReferences(statement.body, functionLabels, forbiddenLabels);
  }
}

export function validateFunctionRecursion(functions: ReadonlyMap<string, FunctionDefinition>): void {
  const graph = new Map<string, readonly string[]>();
  for (const [key, definition] of functions) {
    const calls = new Set<string>();
    collectFunctionCallsFromStatements(definition.statement.body, functions, calls);
    graph.set(key, [...calls]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (key: string): void => {
    if (visited.has(key)) {
      return;
    }
    if (visiting.has(key)) {
      const start = stack.indexOf(key);
      const cycle = [...stack.slice(start), key].map((cycleKey) => functions.get(cycleKey)?.name ?? cycleKey).join(" -> ");
      throw new DiagnosticError(functions.get(key)?.statement.location ?? { filename: "<unknown>", line: 1 }, `Recursive function calls are not supported: ${cycle}.`);
    }

    visiting.add(key);
    stack.push(key);
    for (const next of graph.get(key) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of functions.keys()) {
    visit(key);
  }
}

function collectLocalNames(statement: Extract<Statement, { kind: "function" }>): readonly string[] {
  const locals: string[] = [];
  collectLocalsFromStatements(statement.body, locals);
  return locals;
}

function collectLocalsFromStatements(statements: readonly Statement[], locals: string[]): void {
  for (const statement of statements) {
    if (statement.kind === "local") {
      locals.push(...statement.names);
      continue;
    }
    if (statement.kind === "function") {
      continue;
    }
    if (statement.kind === "if") {
      collectLocalsFromStatements(statement.thenBranch, locals);
      collectLocalsFromStatements(statement.elseBranch, locals);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectLocalsFromStatements(statement.body, locals);
    }
  }
}

function validateScopedNames(statement: Extract<Statement, { kind: "function" }>, locals: readonly string[]): void {
  const seen = new Map<string, SourceLocation>();
  for (const name of statement.parameters) {
    addScopedName(name, statement.location, seen, "parameter");
  }
  for (const name of locals) {
    addScopedName(name, statement.location, seen, "local variable");
  }
}

function addScopedName(name: string, location: SourceLocation, seen: Map<string, SourceLocation>, kind: string): void {
  const key = normalizeName(name);
  const existing = seen.get(key);
  if (existing) {
    throw new DiagnosticError(location, `Duplicate ${kind} "${name}" first declared at ${existing.filename}:${existing.line}.`);
  }
  seen.set(key, location);
}

function storageName(functionId: number, kind: "P" | "L", index: number, sourceName: string): string {
  const suffix = isStringVariableName(sourceName) ? "$" : isIntegerVariableName(sourceName) ? "%" : "";
  return `MBF${functionId}${kind}${index}${suffix}`;
}

function functionLabelName(entryLabel: string, label: string): string {
  return `${entryLabel}${sanitizeLabel(label)}`;
}

function sanitizeLabel(label: string): string {
  const clean = label.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  return clean.length > 0 ? clean : "LABEL";
}

function mergeLabelSets(labelSets: readonly ReadonlyMap<string, string>[]): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const labels of labelSets) {
    for (const [key, label] of labels) {
      merged.set(key, label);
    }
  }
  return merged;
}

function collectLabels(statements: readonly Statement[], labels = new Map<string, string>()): Map<string, string> {
  for (const statement of statements) {
    if (statement.kind === "label") {
      labels.set(normalizeName(statement.name), statement.name);
    } else if (statement.kind === "if") {
      collectLabels(statement.thenBranch, labels);
      collectLabels(statement.elseBranch, labels);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectLabels(statement.body, labels);
    }
  }
  return labels;
}

function validateLabelReferences(statements: readonly Statement[], labels: ReadonlyMap<string, string>, forbiddenLabels: ReadonlyMap<string, string>): void {
  for (const statement of statements) {
    if (statement.kind === "goto" || statement.kind === "gosub") {
      const key = normalizeName(statement.label);
      if (!labels.has(key) && forbiddenLabels.has(key)) {
        throw new DiagnosticError(statement.location, `${statement.kind.toUpperCase()} ${statement.label} cannot cross a FUNCTION boundary.`);
      }
      continue;
    }
    if (statement.kind === "if") {
      validateLabelReferences(statement.thenBranch, labels, forbiddenLabels);
      validateLabelReferences(statement.elseBranch, labels, forbiddenLabels);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      validateLabelReferences(statement.body, labels, forbiddenLabels);
    }
  }
}

function collectFunctionCallsFromStatements(
  statements: readonly Statement[],
  functions: ReadonlyMap<string, FunctionDefinition>,
  calls: Set<string>
): void {
  for (const statement of statements) {
    for (const expression of statementExpressions(statement)) {
      collectFunctionCalls(expression, functions, calls);
    }
    if (statement.kind === "if") {
      collectFunctionCallsFromStatements(statement.thenBranch, functions, calls);
      collectFunctionCallsFromStatements(statement.elseBranch, functions, calls);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectFunctionCallsFromStatements(statement.body, functions, calls);
    }
  }
}

function statementExpressions(statement: Statement): readonly Expression[] {
  switch (statement.kind) {
    case "const":
      return [statement.expression];
    case "dim":
      return statement.dimensions;
    case "cls":
      return statement.color ? [statement.color] : [];
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
      return [statement.color];
    case "print":
      return [...(statement.at ? [statement.at.row, statement.at.column] : []), ...statement.items];
    case "let":
      return [statement.expression];
    case "array-let":
      return [...statement.indices, statement.expression];
    case "return":
      return statement.expression ? [statement.expression] : [];
    case "randomize":
      return statement.seed ? [statement.seed] : [];
    case "for":
      return [statement.start, statement.limit, ...(statement.step ? [statement.step] : [])];
    case "while":
      return [statement.condition];
    case "repeat-until":
      return [statement.condition];
    case "if":
      return [statement.condition];
    case "label":
    case "goto":
    case "gosub":
    case "local":
    case "function":
      return [];
  }
}

function collectFunctionCalls(expression: Expression, functions: ReadonlyMap<string, FunctionDefinition>, calls: Set<string>): void {
  switch (expression.kind) {
    case "function-call": {
      const key = normalizeName(expression.name);
      if (functions.has(key)) {
        calls.add(key);
      }
      for (const arg of expression.args) {
        collectFunctionCalls(arg, functions, calls);
      }
      break;
    }
    case "array-access":
      for (const index of expression.indices) {
        collectFunctionCalls(index, functions, calls);
      }
      break;
    case "parenthesized":
      collectFunctionCalls(expression.expression, functions, calls);
      break;
    case "unary":
      collectFunctionCalls(expression.operand, functions, calls);
      break;
    case "binary":
      collectFunctionCalls(expression.left, functions, calls);
      collectFunctionCalls(expression.right, functions, calls);
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
      break;
  }
}
