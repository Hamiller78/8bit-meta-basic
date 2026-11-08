import type { Expression, Program, Statement } from "./ast.js";
import { statementExpressions } from "./function-semantics.js";
import { builtinFunctions } from "./functions.js";
import { isDefinitelyInteger } from "./semantic.js";
import { normalizeName } from "./symbols.js";
import { isIntegerVariableName, isStringVariableName } from "./variables.js";

type FunctionStatement = Extract<Statement, { kind: "function" }>;
type CallExpression = Extract<Expression, { kind: "function-call" }>;
type ScopeStatement = Extract<Statement, { kind: "function" | "test" }>;
interface CallSite {
  readonly call: CallExpression;
  readonly owner?: ScopeStatement;
  readonly assigned: ReadonlySet<string>;
}
interface ReturnSite {
  readonly expression: Expression;
  readonly assigned: ReadonlySet<string>;
}
interface ArrayWrite {
  readonly expression: Expression;
  readonly owner?: ScopeStatement;
  readonly assigned: ReadonlySet<string>;
}

/** Remove coercions when whole-program and scoped integer facts prove them redundant. */
export function optimizeIntegerParameters(program: Program, options: { readonly inlineIntegerResultIsExact?: boolean } = {}): Program {
  const functions = new Map<string, FunctionStatement>();
  const calls = new Map<string, CallSite[]>();
  const returns = new Map<string, ReturnSite[]>();
  const arrayWrites = new Map<string, ArrayWrite[]>();
  const scalarWrites = new Map<string, ArrayWrite[]>();
  const parameterOwners = new Map<string, { readonly functionKey: string; readonly index: number }[]>();
  const unsafeStorage = new Set<string>();
  const readStorage = new Set<string>();
  const integerArrays = new Set<string>();
  const numericStructArrays = new Set<string>();
  const numericStructScalars = new Set<string>();
  const unsafeScalars = new Set<string>();
  const modifiedParameters = new Map<ScopeStatement, Set<string>>();
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
    if (statement.kind === "let" && statement.sourceName?.includes(".") && !isIntegerVariableName(statement.name) && !isStringVariableName(statement.name)) numericStructScalars.add(normalizeName(statement.name));
    const written = statement.kind === "let" ? [statement.name] : statement.kind === "for" ? [statement.variable] : statement.kind === "input" ? statement.targets.filter((target) => target.kind === "scalar").map((target) => target.name) : statement.kind === "read" ? statement.targets : [];
    if (statement.kind === "input" || statement.kind === "read" || statement.kind === "for") written.forEach((name) => unsafeScalars.add(normalizeName(name)));
    if (owner) for (const name of written) {
      const storage = normalizeName(name);
      if (owner.implementation?.parameters.some((parameter) => normalizeName(parameter.storageName) === storage)) {
        const entries = modifiedParameters.get(owner) ?? new Set<string>();
        entries.add(storage);
        modifiedParameters.set(owner, entries);
      }
    }
    if (statement.kind === "dim" && isIntegerVariableName(statement.name)) integerArrays.add(normalizeName(statement.name));
    if (statement.kind === "dim" && statement.structArrayName && !statement.storageType && !isIntegerVariableName(statement.name) && !isStringVariableName(statement.name)) numericStructArrays.add(normalizeName(statement.name));
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

  const provenParameters = new Map<string, Set<number>>();
  const provenResults = new Set<string>();
  const provenNumericArrays = new Set<string>();
  const provenNumericScalars = new Set<string>();
  const resultIsInteger = (name: string): boolean => provenResults.has(normalizeName(name));
  const arrayIsInteger = (name: string): boolean => (integerArrays.has(normalizeName(name)) || provenNumericArrays.has(normalizeName(name))) && !unsafeArrays.has(normalizeName(name));
  const storageIsInteger = (name: string, owner: ScopeStatement | undefined, assigned: ReadonlySet<string>): boolean => {
    const key = normalizeName(name);
    const integerStorage = isIntegerVariableName(name);
    if (owner && isScopedStorage(owner, key)) {
      if (scopeReads.get(owner)?.has(key)) return false;
      if (assigned.has(key) && !readStorage.has(key)) return true;
      const index = owner.implementation?.parameters.findIndex((parameter) => normalizeName(parameter.storageName) === key) ?? -1;
      if (index >= 0) return owner.kind === "function" && provenParameters.get(normalizeName(owner.name))?.has(index) === true;
    }
    if (!integerStorage) return provenNumericScalars.has(key);
    if (unsafeStorage.has(key)) return false;
    const owners = parameterOwners.get(key);
    return !owners || owners.every((owner) => provenParameters.get(owner.functionKey)?.has(owner.index));
  };

  let changed = true;
  while (changed) {
    changed = false;
    calls.clear(); returns.clear(); arrayWrites.clear(); scalarWrites.clear();
    collectCallSites(program.statements, functions, calls, returns, arrayWrites, scalarWrites, (expression, owner, assigned) => knownInteger(expression, (name) => storageIsInteger(name, owner, assigned), arrayIsInteger, resultIsInteger), readStorage);
    for (const [key, fn] of functions) {
      const sites = calls.get(key);
      if (!sites?.length || !fn.implementation) continue;
      fn.implementation.parameters.forEach((parameter, index) => {
        const storage = normalizeName(parameter.storageName);
        if (parameter.asType || isStringVariableName(parameter.storageName) || scopeReads.get(fn)?.has(storage) || (!isIntegerVariableName(parameter.storageName) && modifiedParameters.get(fn)?.has(storage))) return;
        if (!sites.every(({ call, owner, assigned }) => call.args[index] !== undefined && knownInteger(call.args[index], (name) => storageIsInteger(name, owner, assigned), arrayIsInteger, resultIsInteger))) return;
        const proven = provenParameters.get(key) ?? new Set<number>();
        if (!proven.has(index)) {
          proven.add(index);
          provenParameters.set(key, proven);
          changed = true;
        }
      });
    }
    for (const name of numericStructScalars) {
      if (provenNumericScalars.has(name) || unsafeScalars.has(name) || unsafeStorage.has(name) || parameterOwners.has(name)) continue;
      const sites = scalarWrites.get(name);
      if (sites?.length && sites.every(({ expression, owner, assigned }) => knownInteger(expression, (storage) => storageIsInteger(storage, owner, assigned), arrayIsInteger, resultIsInteger))) {
        provenNumericScalars.add(name);
        changed = true;
      }
    }
    for (const name of numericStructArrays) {
      if (provenNumericArrays.has(name) || unsafeArrays.has(name)) continue;
      if ((arrayWrites.get(name) ?? []).every(({ expression, owner, assigned }) => knownInteger(expression, (storage) => storageIsInteger(storage, owner, assigned), arrayIsInteger, resultIsInteger))) {
        provenNumericArrays.add(name);
        changed = true;
      }
    }
    for (const [key, fn] of functions) {
      const sites = returns.get(key);
      if (provenResults.has(key) || !sites?.length || !endsWithReturn(fn.body) || (fn.inline && options.inlineIntegerResultIsExact === false)) continue;
      let hasJump = false;
      visitStatements(fn.body, (entry) => { if (entry.kind === "label" || entry.kind === "goto" || entry.kind === "gosub") hasJump = true; });
      if (!hasJump && sites.every(({ expression, assigned }) => knownInteger(expression, (name) => storageIsInteger(name, fn, assigned), arrayIsInteger, resultIsInteger))) {
        provenResults.add(key);
        changed = true;
      }
    }
  }

  const optimize = (statements: readonly Statement[], owner?: ScopeStatement, initial: ReadonlySet<string> = new Set(), structured = false): { statements: readonly Statement[]; assigned: Set<string> } => {
    let assigned = new Set(initial);
    const result = statements.map((original): Statement => {
      let statement = original;
      if ((statement.kind === "let" || statement.kind === "array-let") && isIntegerVariableName(statement.name) &&
          statement.expression.kind === "function-call" && statement.expression.name === builtinFunctions.int && statement.expression.args.length === 1 &&
          knownInteger(statement.expression.args[0], (name) => storageIsInteger(name, owner, assigned), arrayIsInteger, resultIsInteger)) {
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
        const bodyAssigned = new Set(assigned);
        if (statement.kind === "for" && owner && structured && isScopedStorage(owner, normalizeName(statement.variable)) && !readStorage.has(normalizeName(statement.variable)) && knownInteger(statement.start, (name) => storageIsInteger(name, owner, assigned), arrayIsInteger, resultIsInteger) && (!statement.step || knownInteger(statement.step, (name) => storageIsInteger(name, owner, assigned), arrayIsInteger, resultIsInteger)) && !loopModifiesVariable(statement.body, statement.variable)) bodyAssigned.add(normalizeName(statement.variable));
        statement = { ...statement, body: optimize(statement.body, owner, bodyAssigned, structured).statements };
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

function loopModifiesVariable(statements: readonly Statement[], variable: string): boolean {
  const key = normalizeName(variable);
  let modified = false;
  visitStatements(statements, (statement) => {
    if (statement.kind === "let" && normalizeName(statement.name) === key ||
        statement.kind === "for" && normalizeName(statement.variable) === key ||
        statement.kind === "read" && statement.targets.some((target) => normalizeName(target) === key) ||
        statement.kind === "input" && statement.targets.some((target) => target.kind === "scalar" && normalizeName(target.name) === key)) modified = true;
  });
  return modified;
}

function knownInteger(expression: Expression, knownIdentifier: (name: string) => boolean, knownArray: (name: string) => boolean, knownResult: (name: string) => boolean): boolean {
  if (isDefinitelyInteger(expression)) return true;
  switch (expression.kind) {
    case "identifier": return knownIdentifier(expression.name);
    case "array-access": return knownArray(expression.name);
    case "function-call": return knownResult(expression.name);
    case "parenthesized": return knownInteger(expression.expression, knownIdentifier, knownArray, knownResult);
    case "binary": return (expression.operator === "+" || expression.operator === "-") &&
      knownInteger(expression.left, knownIdentifier, knownArray, knownResult) && knownInteger(expression.right, knownIdentifier, knownArray, knownResult);
    default: return false;
  }
}

function endsWithReturn(statements: readonly Statement[]): boolean {
  const last = statements.at(-1);
  return last?.kind === "return" && last.expression !== undefined ||
    last?.kind === "if" && endsWithReturn(last.thenBranch) && endsWithReturn(last.elseBranch);
}

function isScopedStorage(owner: ScopeStatement, storage: string): boolean {
  return owner.implementation?.parameters.some((parameter) => normalizeName(parameter.storageName) === storage) === true ||
    owner.implementation?.locals.some((local) => normalizeName(local.storageName) === storage) === true;
}

function collectCallSites(
  statements: readonly Statement[],
  functions: ReadonlyMap<string, FunctionStatement>,
  calls: Map<string, CallSite[]>,
  returns: Map<string, ReturnSite[]>,
  arrayWrites: Map<string, ArrayWrite[]>,
  scalarWrites: Map<string, ArrayWrite[]>,
  known: (expression: Expression, owner: ScopeStatement | undefined, assigned: ReadonlySet<string>) => boolean,
  readStorage: ReadonlySet<string>,
  owner?: ScopeStatement,
  initial: ReadonlySet<string> = new Set(),
  structured = false
): Set<string> {
  let assigned = new Set(initial);
  for (const statement of statements) {
    if (statement.kind === "let") {
      const key = normalizeName(statement.name);
      const entries = scalarWrites.get(key) ?? [];
      entries.push({ expression: statement.expression, owner, assigned: new Set(assigned) });
      scalarWrites.set(key, entries);
    }
    if (statement.kind === "array-let") {
      const key = normalizeName(statement.name);
      const entries = arrayWrites.get(key) ?? [];
      entries.push({ expression: statement.expression, owner, assigned: new Set(assigned) });
      arrayWrites.set(key, entries);
    }
    if (owner?.kind === "function" && statement.kind === "return" && statement.expression) {
      const key = normalizeName(owner.name);
      const entries = returns.get(key) ?? [];
      entries.push({ expression: statement.expression, assigned: new Set(assigned) });
      returns.set(key, entries);
    }
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
      collectCallSites(statement.body, functions, calls, returns, arrayWrites, scalarWrites, known, readStorage, statement, new Set(), !hasJump);
    } else if (statement.kind === "if") {
      const yes = collectCallSites(statement.thenBranch, functions, calls, returns, arrayWrites, scalarWrites, known, readStorage, owner, assigned, structured);
      const no = collectCallSites(statement.elseBranch, functions, calls, returns, arrayWrites, scalarWrites, known, readStorage, owner, assigned, structured);
      assigned = new Set([...yes].filter((name) => no.has(name)));
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      const bodyAssigned = new Set(assigned);
      if (statement.kind === "for" && owner && structured && isScopedStorage(owner, normalizeName(statement.variable)) && !readStorage.has(normalizeName(statement.variable)) && known(statement.start, owner, assigned) && (!statement.step || known(statement.step, owner, assigned)) && !loopModifiesVariable(statement.body, statement.variable)) bodyAssigned.add(normalizeName(statement.variable));
      collectCallSites(statement.body, functions, calls, returns, arrayWrites, scalarWrites, known, readStorage, owner, bodyAssigned, structured);
    } else if (statement.kind === "globals") {
      assigned = collectCallSites(statement.body, functions, calls, returns, arrayWrites, scalarWrites, known, readStorage, owner, assigned, structured);
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
