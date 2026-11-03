import type { Expression, SourceLocation, Statement } from "./ast.js";
import { nextTempName, type FunctionCallLoweringContext } from "./function-call-lowering.js";
import { builtinFunctions } from "./functions.js";
import type { Instruction } from "./lowering.js";

const valuesName = "MBTRND";
const indexName = "MBTRNI";
const countName = "MBTRNC";
const resultName = "MBTRNV";

/** Allocate only when SET_RND is present; other test builds keep native RND. */
export function createTestRandomRuntime(statements: readonly Statement[], nextLabel: () => string) {
  const setters = collectSetters(statements);
  if (setters.length === 0) return undefined;
  const capacity = Math.max(...setters.map(statement => statement.expression.args.length));
  const location = setters[0].location;
  const entryLabel = nextLabel();
  const queuedLabel = nextLabel();
  const id = (name: string): Expression => ({ kind: "identifier", name, location });
  const num = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
  const reset: Instruction[] = [
    { kind: "let", name: indexName, expression: num(0), location },
    { kind: "let", name: countName, expression: num(0), location }
  ];
  const helper: Instruction[] = [
    { kind: "label", name: entryLabel, internal: true, location },
    { kind: "if-goto", condition: { kind: "binary", operator: "<", left: id(indexName), right: id(countName), location }, label: queuedLabel, location },
    { kind: "let", name: resultName, expression: { kind: "function-call", name: builtinFunctions.rnd, args: [], location }, location },
    { kind: "return", location },
    { kind: "label", name: queuedLabel, internal: true, location },
    { kind: "let", name: resultName, expression: { kind: "array-access", name: valuesName, indices: [id(indexName)], location }, location },
    { kind: "let", name: indexName, expression: { kind: "binary", operator: "+", left: id(indexName), right: num(1), location }, location },
    { kind: "return", location }
  ];
  const initialization: Instruction[] = [{ kind: "dim-array", name: valuesName, dimensions: [capacity], location }, ...reset];
  return {
    initialization,
    reset,
    helper,
    expandCall(expression: Extract<Expression, { kind: "function-call" }>, instructions: Instruction[], context: FunctionCallLoweringContext): Expression | undefined {
      if (expression.name !== builtinFunctions.rnd) return undefined;
      const name = nextTempName(context, resultName);
      instructions.push({ kind: "gosub", label: entryLabel, location: expression.location });
      instructions.push({ kind: "let", name, expression: id(resultName), location: expression.location });
      return { kind: "identifier", name, location: expression.location };
    },
    setSequence(values: readonly Expression[], instructions: Instruction[], setterLocation: SourceLocation) {
      // The caller evaluates every argument before overwriting the previous queue.
      values.forEach((expression, index) => instructions.push({
        kind: "array-let", name: valuesName, indices: [{ kind: "number", value: index, raw: String(index), location: setterLocation }], expression, location: setterLocation
      }));
      instructions.push({ kind: "let", name: indexName, expression: num(0), location: setterLocation });
      instructions.push({ kind: "let", name: countName, expression: num(values.length), location: setterLocation });
    }
  };
}

function collectSetters(statements: readonly Statement[]): Extract<Statement, { kind: "function-call-statement" }>[] {
  return statements.flatMap(statement => {
    if (statement.kind === "function-call-statement" && statement.expression.name === builtinFunctions.setRnd) return [statement];
    if (statement.kind === "if") return [...collectSetters(statement.thenBranch), ...collectSetters(statement.elseBranch)];
    if (statement.kind === "function" || statement.kind === "test" || statement.kind === "globals" || statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") return collectSetters(statement.body);
    return [];
  });
}
