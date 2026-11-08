import type { Expression, Program, Statement } from "./ast.js";
import { statementExpressions } from "./function-semantics.js";
import { builtinFunctions } from "./functions.js";
import { isDefinitelyInteger } from "./semantic.js";
import { normalizeName } from "./symbols.js";
import { isIntegerVariableName } from "./variables.js";

type FunctionStatement = Extract<Statement, { kind: "function" }>;
type CallExpression = Extract<Expression, { kind: "function-call" }>;
type ScopeStatement = Extract<Statement, { kind: "function" | "test" }>;
interface CallSite {
  readonly call: CallExpression;
  readonly owner?: ScopeStatement;
  readonly assigned: ReadonlySet<string>;
}

/** Remove coercions when whole-program and scoped integer facts prove them redundant. */
export function optimizeIntegerParameters(program: Program): Program {
  const functions = new Map<string, FunctionStatement>();
  const calls = new Map<string, CallSite[]>();
  const parameterOwners = new Map<string, { readonly functionKey: string; readonly index: number }[]>();
  const unsafeStorage = new Set<string>();
  const readStorage = new Set<string>();
  const integerArrays = new Set<string>();
  const unsafeArrays = new Set<string>();
  const scopeReads = new Map<ScopeStatement, Set<string>>();

  for (const statement of program.statements) {
    if (statement.kind !== "function" || !statement.implementation) continue;
    const functionKey = normalizeName(statement.name);
    functions.set(functionKey, statement);
    unsafeStorage.add(normalizeName(statement.implementation.returnName));
    statement.implementation.parameters.forEach((parameter, index) => {
      // Struct parameters are copied field by field during call lowering; their
      // generated scalar storage is not represented by the parameter slot.
      parameter.structFields?.forEach((field) => unsafeStorage.add(normalizeName(field.storageName)));
      const storage = normalizeName(parameter.storageName);
      const owners = parameterOwners.get(storage) ?? [];
      owners.push({ functionKey, index });
      parameterOwners.set(storage, owners);
    });
  }

  visitStatements(program.statements, (statement, owner) => {
    if (statement.kind === "dim" && isIntegerVariableName(statement.name)) integerArrays.add(normalizeName(statement.name));
    if (statement.kind === "load-file") statement.arrays?.forEach((array) => unsafeArrays.add(normalizeName(array.name)));
    if (statement.kind === "insert-element" || statement.kind === "remove-element") {
      statement.fields?.forEach((field) => unsafeArrays.add(normalizeName(field.arrayName)));
    }
    if (statement.kind === "read") {
      for (const target of statement.targets) {
        const storage = normalizeName(target);
        unsafeStorage.add(storage);
        readStorage.add(storage);
        if (owner && isScopedStorage(owner, storage)) {
          const reads = scopeReads.get(owner) ?? new Set<string>();
          reads.add(storage);
          scopeReads.set(owner, reads);
        }
      }
    }
  });

  collectCallSites(program.statements, functions, calls);

  const provenParameters = new Map<string, Set<number>>();
  const arrayIsInteger = (name: string): boolean => integerArrays.has(normalizeName(name)) && !unsafeArrays.has(normalizeName(name));
  const storageIsInteger = (name: string, owner: ScopeStatement | undefined, assigned: ReadonlySet<string>): boolean => {
    const key = normalizeName(name);
    if (!isIntegerVariableName(name)) return false;
    if (owner && isScopedStorage(owner, key)) {
      if (scopeReads.get(owner)?.has(key)) return false;
      if (assigned.has(key) && !readStorage.has(key)) return true;
      const index = owner.implementation?.parameters.findIndex((parameter) => normalizeName(parameter.storageName) === key) ?? -1;
      if (index >= 0) return owner.kind === "function" && provenParameters.get(normalizeName(owner.name))?.has(index) === true;
    }
    if (unsafeStorage.has(key)) return false;
    const owners = parameterOwners.get(key);
    return !owners || owners.every((owner) => provenParameters.get(owner.functionKey)?.has(owner.index));
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, fn] of functions) {
      const sites = calls.get(key);
      if (!sites?.length || !fn.implementation) continue;
      fn.implementation.parameters.forEach((parameter, index) => {
        const storage = normalizeName(parameter.storageName);
        if (!isIntegerVariableName(parameter.storageName) || scopeReads.get(fn)?.has(storage)) return;
        if (!sites.every(({ call, owner, assigned }) => call.args[index] !== undefined && knownInteger(call.args[index], (name) => storageIsInteger(name, owner, assigned), arrayIsInteger))) return;
        const proven = provenParameters.get(key) ?? new Set<number>();
        if (!proven.has(index)) {
          proven.add(index);
          provenParameters.set(key, proven);
          changed = true;
        }
      });
    }
  }

  const optimize = (statements: readonly Statement[], owner?: ScopeStatement, initial: ReadonlySet<string> = new Set(), structured = false): { statements: readonly Statement[]; assigned: Set<string> } => {
    let assigned = new Set(initial);
    const result = statements.map((original): Statement => {
      let statement = original;
      if ((statement.kind === "let" || statement.kind === "array-let") && isIntegerVariableName(statement.name) &&
          statement.expression.kind === "function-call" && statement.expression.name === builtinFunctions.int && statement.expression.args.length === 1 &&
          knownInteger(statement.expression.args[0], (name) => storageIsInteger(name, owner, assigned), arrayIsInteger)) {
        statement = { ...statement, expression: statement.expression.args[0] };
      }
      if (statement.kind === "function" || statement.kind === "test") {
        let hasJump = false;
        visitStatements(statement.body, (entry) => { if (entry.kind === "label" || entry.kind === "goto" || entry.kind === "gosub") hasJump = true; });
        statement = { ...statement, body: optimize(statement.body, statement, new Set(), !hasJump).statements };
      } else if (statement.kind === "if") {
        const yes = optimize(statement.thenBranch, owner, assigned, structured);
        const no = optimize(statement.elseBranch, owner, assigned, structured);
        assigned = new Set([...yes.assigned].filter((name) => no.assigned.has(name)));
        statement = { ...statement, thenBranch: yes.statements, elseBranch: no.statements };
      } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
        statement = { ...statement, body: optimize(statement.body, owner, assigned, structured).statements };
      } else if (statement.kind === "globals") {
        const body = optimize(statement.body, owner, assigned, structured);
        assigned = body.assigned;
        statement = { ...statement, body: body.statements };
      }
      if (structured && owner && statement.kind === "let" && isIntegerVariableName(statement.name) && isScopedStorage(owner, normalizeName(statement.name))) assigned.add(normalizeName(statement.name));
      return statement;
    });
    return { statements: result, assigned };
  };
  return { ...program, statements: optimize(program.statements).statements };
}

function knownInteger(expression: Expression, knownIdentifier: (name: string) => boolean, knownArray: (name: string) => boolean): boolean {
  if (isDefinitelyInteger(expression)) return true;
  switch (expression.kind) {
    case "identifier": return knownIdentifier(expression.name);
    case "array-access": return knownArray(expression.name);
    case "parenthesized": return knownInteger(expression.expression, knownIdentifier, knownArray);
    case "binary": return (expression.operator === "+" || expression.operator === "-") &&
      knownInteger(expression.left, knownIdentifier, knownArray) && knownInteger(expression.right, knownIdentifier, knownArray);
    default: return false;
  }
}

function isScopedStorage(owner: ScopeStatement, storage: string): boolean {
  return owner.implementation?.parameters.some((parameter) => normalizeName(parameter.storageName) === storage) === true ||
    owner.implementation?.locals.some((local) => normalizeName(local.storageName) === storage) === true;
}

function collectCallSites(
  statements: readonly Statement[],
  functions: ReadonlyMap<string, FunctionStatement>,
  calls: Map<string, CallSite[]>,
  owner?: ScopeStatement,
  initial: ReadonlySet<string> = new Set(),
  structured = false
): Set<string> {
  let assigned = new Set(initial);
  for (const statement of statements) {
    for (const expression of expressionsInStatement(statement)) {
      visitExpression(expression, (call) => {
        const key = normalizeName(call.name);
        if (!functions.has(key)) return;
        const entries = calls.get(key) ?? [];
        entries.push({ call, owner, assigned: new Set(assigned) });
        calls.set(key, entries);
      });
    }
    if (statement.kind === "function" || statement.kind === "test") {
      let hasJump = false;
      visitStatements(statement.body, (entry) => { if (entry.kind === "label" || entry.kind === "goto" || entry.kind === "gosub") hasJump = true; });
      collectCallSites(statement.body, functions, calls, statement, new Set(), !hasJump);
    } else if (statement.kind === "if") {
      const yes = collectCallSites(statement.thenBranch, functions, calls, owner, assigned, structured);
      const no = collectCallSites(statement.elseBranch, functions, calls, owner, assigned, structured);
      assigned = new Set([...yes].filter((name) => no.has(name)));
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectCallSites(statement.body, functions, calls, owner, assigned, structured);
    } else if (statement.kind === "globals") {
      assigned = collectCallSites(statement.body, functions, calls, owner, assigned, structured);
    }
    if (structured && owner && statement.kind === "let" && isIntegerVariableName(statement.name) && isScopedStorage(owner, normalizeName(statement.name))) {
      assigned.add(normalizeName(statement.name));
    }
  }
  return assigned;
}

function visitStatements(statements: readonly Statement[], visit: (statement: Statement, owner?: ScopeStatement) => void, owner?: ScopeStatement): void {
  for (const statement of statements) {
    visit(statement, owner);
    if (statement.kind === "if") {
      visitStatements(statement.thenBranch, visit, owner);
      visitStatements(statement.elseBranch, visit, owner);
    } else if (statement.kind === "function" || statement.kind === "test") {
      visitStatements(statement.body, visit, statement);
    } else if (statement.kind === "globals" || statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      visitStatements(statement.body, visit, owner);
    }
  }
}

function expressionsInStatement(statement: Statement): readonly Expression[] {
  switch (statement.kind) {
    case "assert-true": case "assert-false": case "assert-eq": case "assert-ne": case "assert-print": case "assert-printat":
    case "assert-screen-border-color": case "assert-screen-background-color": case "assert-screen-text-color":
    case "assert-cell-text-color": case "assert-cell-background-color":
      return [statement.actual, ...(statement.expected ? [statement.expected] : []), ...(statement.row ? [statement.row] : []), ...(statement.column ? [statement.column] : [])];
    default: return statementExpressions(statement);
  }
}

function visitExpression(expression: Expression, visit: (call: CallExpression) => void): void {
  switch (expression.kind) {
    case "function-call":
      visit(expression);
      expression.args.forEach((argument) => visitExpression(argument, visit));
      break;
    case "array-access": case "struct-field-access":
      expression.indices.forEach((index) => visitExpression(index, visit));
      break;
    case "parenthesized": visitExpression(expression.expression, visit); break;
    case "unary": visitExpression(expression.operand, visit); break;
    case "binary": visitExpression(expression.left, visit); visitExpression(expression.right, visit); break;
    default: break;
  }
}
