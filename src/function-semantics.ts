import type { Expression, FunctionImplementation, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { canonicalFunctionName } from "./functions.js";
import { normalizeName } from "./symbols.js";
import { isIntegerVariableName, isStringVariableName } from "./variables.js";

export interface FunctionDefinition {
  readonly name: string;
  readonly key: string;
  readonly valueType: "number" | "string";
  readonly returnsValue: boolean;
  readonly inline: boolean;
  readonly implementation: FunctionImplementation;
  readonly statement: Extract<Statement, { kind: "function" }>;
}

export interface FunctionScope {
  readonly kind: "function" | "test";
  readonly functionName: string;
  readonly returnName: string;
  readonly returnsValue: boolean;
  readonly variables: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string>;
}

interface PendingFunctionDefinition {
  readonly id: number;
  readonly name: string;
  readonly key: string;
  readonly valueType: "number" | "string";
  readonly returnsValue: boolean;
  readonly inline: boolean;
  readonly locals: readonly string[];
  readonly statement: Extract<Statement, { kind: "function" }>;
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
    kind: "function",
    functionName: definition.name,
    returnName: definition.implementation.returnName,
    returnsValue: definition.returnsValue,
    variables,
    labels
  };
}

export function createTestScope(statement: Extract<Statement, { kind: "test" }>): FunctionScope {
  if (!statement.implementation) {
    throw new DiagnosticError(statement.location, `Internal error: TEST ${statement.name} was not analyzed before scoping.`);
  }

  const variables = new Map<string, string>();
  for (const local of statement.implementation.locals) {
    variables.set(normalizeName(local.sourceName), local.storageName);
  }

  const labels = new Map<string, string>();
  collectLabels(statement.body, labels);
  for (const [key, label] of labels) {
    labels.set(key, functionLabelName(statement.implementation.entryLabel, label));
  }

  return {
    kind: "test",
    functionName: statement.name,
    returnName: statement.implementation.returnName,
    returnsValue: false,
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
    if (statement.kind === "struct") {
      return false;
    }
    return false;
  });
}

export function containsBareFunctionReturn(statements: readonly Statement[]): boolean {
  return statements.some((statement) => {
    if (statement.kind === "return" && !statement.expression) {
      return true;
    }
    if (statement.kind === "if") {
      return containsBareFunctionReturn(statement.thenBranch) || containsBareFunctionReturn(statement.elseBranch);
    }
    if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      return containsBareFunctionReturn(statement.body);
    }
    if (statement.kind === "struct") {
      return false;
    }
    return false;
  });
}

export function collectFunctionDefinitions(statements: readonly Statement[]): ReadonlyMap<string, FunctionDefinition> {
  const pending: PendingFunctionDefinition[] = [];
  const provisional = new Map<string, FunctionDefinition>();
  let nextId = 1;

  for (const statement of statements) {
    if (statement.kind !== "function") {
      continue;
    }

    const key = normalizeName(statement.name);
    if (canonicalFunctionName(statement.name)) {
      throw new DiagnosticError(statement.location, `Cannot declare FUNCTION "${statement.name}" with the same name as a built-in function.`);
    }
    if (provisional.has(key)) {
      throw new DiagnosticError(statement.location, `Duplicate FUNCTION "${statement.name}".`);
    }

    const id = nextId;
    nextId += 1;
    const locals = collectLocalNames(statement);
    validateScopedNames(statement, locals);
    const returnsValue = containsFunctionReturn(statement.body);
    if (returnsValue && containsBareFunctionReturn(statement.body)) {
      throw new DiagnosticError(statement.location, `FUNCTION ${statement.name} cannot mix RETURN with and without an expression.`);
    }
    if (statement.inline) {
      validateInlineFunctionBody(statement, returnsValue);
    }
    const pendingDefinition = {
      id,
      name: statement.name,
      key,
      valueType: isStringVariableName(statement.name) ? "string" : "number",
      returnsValue,
      inline: statement.inline === true,
      locals,
      statement
    } satisfies PendingFunctionDefinition;
    pending.push(pendingDefinition);
    provisional.set(key, {
      name: pendingDefinition.name,
      key,
      valueType: pendingDefinition.valueType,
      returnsValue: pendingDefinition.returnsValue,
      inline: pendingDefinition.inline,
      implementation: uniqueFunctionImplementation(pendingDefinition),
      statement
    });
  }

  const graph = buildFunctionCallGraph(provisional);
  const implementations = allocateFunctionStorage(pending, graph);
  const functions = new Map<string, FunctionDefinition>();
  for (const definition of pending) {
    functions.set(definition.key, {
      name: definition.name,
      key: definition.key,
      valueType: definition.valueType,
      returnsValue: definition.returnsValue,
      inline: definition.inline,
      implementation: implementations.get(definition.key) ?? uniqueFunctionImplementation(definition),
      statement: definition.statement
    });
  }

  return functions;
}

export function attachTestImplementations(statements: readonly Statement[]): readonly Statement[] {
  let nextId = 1;
  const seen = new Map<string, SourceLocation>();

  return statements.map((statement) => {
    if (statement.kind !== "test") {
      return statement;
    }

    const key = normalizeName(statement.name);
    const existing = seen.get(key);
    if (existing) {
      throw new DiagnosticError(statement.location, `Duplicate TEST "${statement.name}" first declared at ${existing.filename}:${existing.line}.`);
    }
    seen.set(key, statement.location);

    const id = nextId;
    nextId += 1;
    const locals = collectLocalNames(statement);
    validateScopedNames(statement, locals);
    return {
      ...statement,
      implementation: {
        entryLabel: `MBTEST${id}ENTRY`,
        returnName: `MBTEST${id}R`,
        parameters: [],
        locals: locals.map((local, index) => ({
          sourceName: local,
          storageName: testStorageName(index + 1, local)
        }))
      }
    };
  });
}

function uniqueFunctionImplementation(definition: PendingFunctionDefinition): FunctionImplementation {
  return {
    entryLabel: `MBF${definition.id}ENTRY`,
    returnName: storageName(definition.id, "R", 0, definition.name),
      parameters: definition.statement.parameters.map((parameter, index) => ({
        sourceName: parameter,
        storageName: storageName(definition.id, "P", index + 1, parameter),
        ...parameterTypeProperties(definition.statement, parameter)
      })),
    locals: definition.locals.map((local, index) => ({
      sourceName: local,
      storageName: storageName(definition.id, "L", index + 1, local)
    }))
  };
}

function buildFunctionCallGraph(functions: ReadonlyMap<string, FunctionDefinition>): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  for (const [key, definition] of functions) {
    const calls = new Set<string>();
    collectFunctionCallsFromStatements(definition.statement.body, functions, calls);
    graph.set(key, [...calls]);
  }
  return graph;
}

function allocateFunctionStorage(
  definitions: readonly PendingFunctionDefinition[],
  graph: ReadonlyMap<string, readonly string[]>
): ReadonlyMap<string, FunctionImplementation> {
  const reachability = buildReachability(definitions, graph);
  const allocator = createStaticStorageAllocator(reachability);
  const implementations = new Map<string, FunctionImplementation>();

  for (const definition of definitions) {
    implementations.set(definition.key, {
      entryLabel: `MBF${definition.id}ENTRY`,
      returnName: allocator.allocate(definition.key, "R", 0, definition.name),
      parameters: definition.statement.parameters.map((parameter, index) => ({
        sourceName: parameter,
        storageName: allocator.allocate(definition.key, "P", index + 1, parameter),
        ...parameterTypeProperties(definition.statement, parameter)
      })),
      locals: definition.locals.map((local, index) => ({
        sourceName: local,
        storageName: allocator.allocate(definition.key, "L", index + 1, local)
      }))
    });
  }

  return implementations;
}

function buildReachability(
  definitions: readonly PendingFunctionDefinition[],
  graph: ReadonlyMap<string, readonly string[]>
): ReadonlyMap<string, ReadonlySet<string>> {
  const reachability = new Map<string, ReadonlySet<string>>();
  for (const definition of definitions) {
    const seen = new Set<string>();
    const visit = (key: string): void => {
      for (const next of graph.get(key) ?? []) {
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        visit(next);
      }
    };
    visit(definition.key);
    reachability.set(definition.key, seen);
  }
  return reachability;
}

function createStaticStorageAllocator(reachability: ReadonlyMap<string, ReadonlySet<string>>) {
  const slots = new Map<string, Map<number, string[]>>();

  return {
    allocate(functionKey: string, kind: "P" | "L" | "R", index: number, sourceName: string): string {
      const suffix = storageSuffix(sourceName);
      const poolKey = `${kind}:${index}:${suffix}`;
      let pool = slots.get(poolKey);
      if (!pool) {
        pool = new Map<number, string[]>();
        slots.set(poolKey, pool);
      }

      for (let slot = 1; ; slot += 1) {
        const owners = pool.get(slot) ?? [];
        if (owners.every((owner) => !functionsCanBeActiveTogether(functionKey, owner, reachability))) {
          pool.set(slot, [...owners, functionKey]);
          return storageName(slot, kind, index, sourceName);
        }
      }
    }
  };
}

function functionsCanBeActiveTogether(left: string, right: string, reachability: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  return left === right || (reachability.get(left)?.has(right) ?? false) || (reachability.get(right)?.has(left) ?? false);
}

export function validateControlFlowBoundaries(statements: readonly Statement[]): void {
  const topLevelLabels = collectLabels(statements.filter((statement) => statement.kind !== "function" && statement.kind !== "test"));
  const functionLabelSets = statements
    .filter((statement): statement is Extract<Statement, { kind: "function" | "test" }> => statement.kind === "function" || statement.kind === "test")
    .map((statement) => collectLabels(statement.body));
  const allFunctionLabels = mergeLabelSets(functionLabelSets);
  validateLabelReferences(statements.filter((statement) => statement.kind !== "function" && statement.kind !== "test"), topLevelLabels, allFunctionLabels);

  for (const statement of statements) {
    if (statement.kind !== "function" && statement.kind !== "test") {
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

function collectLocalNames(statement: Extract<Statement, { kind: "function" | "test" }>): readonly string[] {
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
    if (statement.kind === "function" || statement.kind === "test") {
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

function validateScopedNames(statement: Extract<Statement, { kind: "function" | "test" }>, locals: readonly string[]): void {
  const seen = new Map<string, SourceLocation>();
  for (const name of statement.kind === "function" ? statement.parameters : []) {
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

function validateInlineFunctionBody(statement: Extract<Statement, { kind: "function" }>, returnsValue: boolean): void {
  const last = statement.body[statement.body.length - 1];
  const returns = collectReturns(statement.body);
  if (returns.length > 0 && (returns.length !== 1 || last?.kind !== "return")) {
    throw new DiagnosticError(statement.location, `INLINE FUNCTION ${statement.name} supports only a final RETURN statement.`);
  }
  if (returnsValue && last?.kind !== "return") {
    throw new DiagnosticError(statement.location, `INLINE FUNCTION ${statement.name} must end with RETURN expression.`);
  }

  const parameters = new Set(statement.parameters.map((parameter) => normalizeName(parameter)));
  validateInlineStatements(statement.body, statement, parameters);
}

function collectReturns(statements: readonly Statement[], returns: Statement[] = []): readonly Statement[] {
  for (const statement of statements) {
    if (statement.kind === "return") {
      returns.push(statement);
    } else if (statement.kind === "if") {
      collectReturns(statement.thenBranch, returns);
      collectReturns(statement.elseBranch, returns);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectReturns(statement.body, returns);
    }
  }
  return returns;
}

function validateInlineStatements(
  statements: readonly Statement[],
  owner: Extract<Statement, { kind: "function" }>,
  parameters: ReadonlySet<string>
): void {
  for (const statement of statements) {
    if (statement.kind === "label" || statement.kind === "goto" || statement.kind === "gosub") {
      throw new DiagnosticError(statement.location, `INLINE FUNCTION ${owner.name} cannot contain labels, GOTO, or GOSUB.`);
    }
    if (statement.kind === "exit-for" || statement.kind === "continue-for") {
      throw new DiagnosticError(statement.location, `INLINE FUNCTION ${owner.name} cannot contain EXIT FOR or CONTINUE FOR.`);
    }
    if ((statement.kind === "let" || statement.kind === "array-let") && parameters.has(normalizeName(statement.name))) {
      throw new DiagnosticError(statement.location, `INLINE FUNCTION ${owner.name} cannot assign to parameter "${statement.name}".`);
    }
    if (statement.kind === "for" && parameters.has(normalizeName(statement.variable))) {
      throw new DiagnosticError(statement.location, `INLINE FUNCTION ${owner.name} cannot assign to parameter "${statement.variable}".`);
    }
    if (statement.kind === "if") {
      validateInlineStatements(statement.thenBranch, owner, parameters);
      validateInlineStatements(statement.elseBranch, owner, parameters);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      validateInlineStatements(statement.body, owner, parameters);
    }
  }
}

function storageName(functionId: number, kind: "P" | "L" | "R", index: number, sourceName: string): string {
  const suffix = storageSuffix(sourceName);
  return kind === "R" ? `MBF${functionId}R${suffix}` : `MBF${functionId}${kind}${index}${suffix}`;
}

function testStorageName(index: number, sourceName: string): string {
  const suffix = storageSuffix(sourceName);
  return `MBTEST1L${index}${suffix}`;
}

function parameterTypeProperties(statement: Extract<Statement, { kind: "function" }>, parameter: string): { readonly asType?: string } {
  const type = statement.parameterTypes?.find((candidate) => normalizeName(candidate.name) === normalizeName(parameter));
  return type ? { asType: type.asType } : {};
}

function storageSuffix(sourceName: string): string {
  return isStringVariableName(sourceName) ? "$" : isIntegerVariableName(sourceName) ? "%" : "";
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
    } else if (statement.kind === "globals") {
      collectLabels(statement.body, labels);
    } else if (statement.kind === "function" || statement.kind === "test") {
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
    } else if (statement.kind === "globals") {
      validateLabelReferences(statement.body, labels, forbiddenLabels);
    } else if (statement.kind === "test") {
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
    } else if (statement.kind === "globals") {
      collectFunctionCallsFromStatements(statement.body, functions, calls);
    }
  }
}

export function statementExpressions(statement: Statement): readonly Expression[] {
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
    case "print-device":
      return statement.items;
    case "data":
      return statement.values;
    case "let":
      return [statement.expression];
    case "array-let":
      return [...statement.indices, statement.expression];
    case "struct-field-let":
      return [...statement.indices, statement.expression];
    case "function-call-statement":
      return [statement.expression];
    case "insert-element":
      return [statement.target, statement.index, statement.value];
    case "remove-element":
      return [statement.target, statement.index];
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
    case "uses":
    case "comment":
    case "goto":
    case "gosub":
    case "exit-for":
    case "continue-for":
    case "read":
    case "open-device":
    case "close-device":
    case "suppress-scroll-prompt":
    case "program-mode":
    case "restore":
    case "end":
    case "local":
    case "function":
    case "test":
    case "globals":
    case "struct":
    case "enum":
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
    case "struct-field-access":
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
