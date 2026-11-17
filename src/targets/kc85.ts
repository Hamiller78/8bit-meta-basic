import { DiagnosticError } from "../diagnostics.js";
import type { Expression } from "../ast.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { mapInstructionExpressions } from "./instruction-expressions.js";
import { renderKc85Line } from "./kc85-render.js";
import { kc85VariableMap } from "./kc85-variables.js";
import { lowerByteStorage } from "./byte-storage.js";
import { lowerInkeyReads } from "./inkey-lowering.js";
import { lowerSafeDispatch } from "./safe-dispatch.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { rebuildLabels, validateConstantCoordinate, type TargetBackend } from "./target.js";

let currentInstructions: readonly Instruction[] = [];

export function setKc85RenderProgram(instructions: readonly Instruction[]): void {
  currentInstructions = instructions;
}

/** Initial HC-BASIC backend; unsupported operations are diagnosed by its renderer. */
export const kc85Target: TargetBackend = {
  id: "kc85",
  gotoSpelling: "GOTO",
  maxLineLength: 72,
  maxLineNumber: 65529,
  variableMap: kc85VariableMap,
  lower(program: LoweredProgram): LoweredProgram {
    const validateExpression = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "string":
          if (/[^\x20-\x7e]/u.test(expression.value)) {
            throw new DiagnosticError(expression.location, "KC 85/3 currently supports ASCII text only.");
          }
          break;
        case "function-call": expression.args.forEach(validateExpression); break;
        case "array-access": case "struct-field-access": expression.indices.forEach(validateExpression); break;
        case "parenthesized": validateExpression(expression.expression); break;
        case "unary": validateExpression(expression.operand); break;
        case "binary": validateExpression(expression.left); validateExpression(expression.right); break;
        default: break;
      }
      return expression;
    };
    const validate = (instruction: Instruction): void => {
      if (instruction.kind === "if-then") instruction.body.forEach(validate);
      mapInstructionExpressions(instruction, validateExpression);
    };
    program.instructions.forEach(validate);
    const byteProgram = lowerByteStorage(program, "kc85");
    const allocate = createGeneratedVariableNameAllocator(byteProgram.instructions, "MBKC85SEED");
    let seedStorage: string | undefined;
    const seedRandom = (instruction: Instruction): Instruction => {
      if (instruction.kind === "if-then") return { ...instruction, body: instruction.body.map(seedRandom) };
      if (instruction.kind !== "randomize" || !instruction.seed) return instruction;
      seedStorage ??= allocate();
      return {
        kind: "let", name: seedStorage, location: instruction.location,
        expression: { kind: "function-call", name: "__KC85_SEED_RND", args: [instruction.seed], valueType: "number", location: instruction.location }
      };
    };
    const seeded = rebuildLabels(byteProgram, byteProgram.instructions.map(seedRandom));
    // Keep long literal-only output editable without changing its visible text.
    const splitLongPrint = (instruction: Instruction): Instruction[] => {
      if (instruction.kind !== "print" || instruction.inverted || instruction.items.length !== 1 || instruction.items[0].kind !== "string" || instruction.items[0].value.length <= 50) return [instruction];
      const literal = instruction.items[0];
      const chunks = literal.value.match(/[\s\S]{1,50}/gu) ?? [];
      return chunks.map((value, index) => ({
        ...instruction,
        ...(index > 0 ? { at: undefined } : {}),
        items: [{ ...literal, value }],
        trailingSemicolon: index < chunks.length - 1 || instruction.trailingSemicolon
      }));
    };
    const split = rebuildLabels(seeded, seeded.instructions.flatMap(splitLongPrint));
    return lowerSafeDispatch(lowerKc85ScreenReads(lowerInkeyReads(split, "MBKC85KEY")), "MBKC85DISPATCH");
  },
  renderLine(lineNumber, instruction, labelLines): string {
    return renderKc85Line(lineNumber, instruction, labelLines, kc85VariableMap(currentInstructions));
  }
};

function lowerKc85ScreenReads(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBKC85SCREEN");
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[] } => {
    const prefix: Instruction[] = [];
    const rewrite = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "function-call": {
          const args = expression.args.map(rewrite);
          if (expression.name !== "SCREEN_CODE") return { ...expression, args };
          validateConstantCoordinate(args[0], "row", 29, "KC 85", "SCREEN_CODE");
          validateConstantCoordinate(args[1], "column", 39, "KC 85", "SCREEN_CODE");
          const location = expression.location;
          const row = allocate(), column = allocate(), savedRow = allocate(), savedColumn = allocate(), value = allocate();
          const id = (name: string): Expression => ({ kind: "identifier", name, location });
          const call = (name: string): Expression => ({ kind: "function-call", name, args: [], valueType: "number", location });
          prefix.push(
            { kind: "let", name: row, expression: args[0], location },
            { kind: "let", name: column, expression: args[1], location },
            { kind: "let", name: savedRow, expression: call("__KC85_ROW"), location },
            { kind: "let", name: savedColumn, expression: call("__KC85_COLUMN"), location },
            { kind: "set-position", row: id(row), column: id(column), location },
            { kind: "let", name: value, expression: call("__KC85_SCREEN"), location },
            { kind: "set-position", row: id(savedRow), column: id(savedColumn), location }
          );
          return id(value);
        }
        case "array-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "struct-field-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "parenthesized": return { ...expression, expression: rewrite(expression.expression) };
        case "unary": return { ...expression, operand: rewrite(expression.operand) };
        case "binary": return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
        default: return expression;
      }
    };
    if (instruction.kind === "if-then") {
      const condition = rewrite(instruction.condition);
      const body = instruction.body.flatMap((item) => {
        const result = lower(item);
        return [...result.prefix, result.instruction];
      });
      return { instruction: { ...instruction, condition, body }, prefix };
    }
    return { instruction: mapInstructionExpressions(instruction, rewrite), prefix };
  };
  return rebuildLabels(program, program.instructions.flatMap((instruction) => {
    const result = lower(instruction);
    return [...result.prefix, result.instruction];
  }));
}
