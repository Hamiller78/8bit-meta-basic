import type { Expression } from "../ast.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { builtinFunctions } from "../functions.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { mapInstructionExpressions } from "./instruction-expressions.js";
import { rebuildLabels } from "./target.js";

export function lowerInkeyReads(program: LoweredProgram, prefix: string): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, prefix, "$");
  const key = allocate();
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[]; suffix: Instruction[] } => {
    const prefix: Instruction[] = [], suffix: Instruction[] = [];
    const location = instruction.location;
    const keyExpr = (): Expression => ({ kind: "identifier", name: key, valueType: "string", location });
    const empty = (): Expression => ({ kind: "string", value: "", location });
    const condition = (operator: "=" | "<>"): Expression => ({ kind: "binary", operator, left: keyExpr(), right: empty(), location });
    const poll = (): void => { prefix.push({ kind: "if-then", condition: condition("="), body: [{ kind: "read-key", name: key, location }], originalSkipLabel: "", location }); };
    const rewrite = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "function-call":
          if (expression.name === builtinFunctions.keyPressed) { poll(); return condition("<>"); }
          return { ...expression, args: expression.args.map(rewrite) };
        case "array-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "struct-field-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "parenthesized": return { ...expression, expression: rewrite(expression.expression) };
        case "unary": return { ...expression, operand: rewrite(expression.operand) };
        case "binary": return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
        default: return expression;
      }
    };
    if (instruction.kind === "let" && instruction.expression.kind === "function-call" && instruction.expression.name === builtinFunctions.keyCode) {
      poll();
      const zero: Expression = { kind: "number", value: 0, raw: "0", location };
      const asc: Expression = { kind: "function-call", name: builtinFunctions.asc, args: [keyExpr()], valueType: "number", location };
      suffix.push({ kind: "if-then", condition: condition("<>"), body: [{ ...instruction, expression: asc }], originalSkipLabel: "", location });
      suffix.push({ kind: "let", name: key, expression: empty(), location });
      return { instruction: { ...instruction, expression: zero }, prefix, suffix };
    }
    if (instruction.kind === "if-then") {
      const conditionValue = rewrite(instruction.condition);
      const body = instruction.body.flatMap((item) => { const result = lower(item); return [...result.prefix, result.instruction, ...result.suffix]; });
      return { instruction: { ...instruction, condition: conditionValue, body }, prefix, suffix };
    }
    return { instruction: mapInstructionExpressions(instruction, rewrite), prefix, suffix };
  };
  return rebuildLabels(program, program.instructions.flatMap((instruction) => {
    const result = lower(instruction);
    return [...result.prefix, result.instruction, ...result.suffix];
  }));
}

