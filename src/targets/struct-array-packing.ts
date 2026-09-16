import type { Expression } from "../ast.js";
import type { Instruction } from "../lowering.js";
import { isIntegerVariableName, isStringVariableName } from "../variables.js";
import { mapInstructionExpressions } from "./instruction-expressions.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";

interface PackedField {
  readonly name: string;
  readonly column: number;
  readonly count: number;
}

/** Pack compiler-generated struct fields into native two-dimensional numeric arrays. */
export function packNumericStructFields(instructions: readonly Instruction[], preserveIntegerStorage = false): readonly Instruction[] {
  const groups = new Map<string, Extract<Instruction, { kind: "dim-array" }>[]>();
  for (const instruction of instructions) {
    if (instruction.kind !== "dim-array" || !instruction.structArrayName || isStringVariableName(instruction.name)) continue;
    const storageType = preserveIntegerStorage && isIntegerVariableName(instruction.name) ? "integer" : "number";
    const key = `${instruction.structArrayName.toLowerCase()}:${storageType}`;
    const fields = groups.get(key) ?? [];
    fields.push(instruction);
    groups.set(key, fields);
  }

  const allocateNumericName = createGeneratedVariableNameAllocator(instructions, "MBSTRUCT");
  const allocateIntegerName = preserveIntegerStorage
    ? createGeneratedVariableNameAllocator(instructions, "MBSTRUCT", "%")
    : allocateNumericName;
  const packedFields = new Map<string, PackedField>();
  const packedFieldNames = new Map<string, readonly string[]>();
  for (const fields of groups.values()) {
    if (fields.length < 2) continue;
    const name = preserveIntegerStorage && isIntegerVariableName(fields[0].name) ? allocateIntegerName() : allocateNumericName();
    packedFieldNames.set(name, fields.map((field) => field.structFieldName ?? field.name));
    fields.forEach((field, column) => {
      packedFields.set(field.name.toLowerCase(), { name, column, count: fields.length });
    });
  }
  if (packedFields.size === 0) return instructions;

  const rewrite = (expression: Expression): Expression => {
    switch (expression.kind) {
      case "array-access": {
        const indices = expression.indices.map(rewrite);
        const field = packedFields.get(expression.name.toLowerCase());
        return {
          ...expression,
          ...(field ? { name: field.name } : {}),
          indices: field ? [...indices, columnExpression(field.column, expression.location)] : indices,
          ...(expression.fixedWidthStorageLength ? { fixedWidthStorageLength: rewrite(expression.fixedWidthStorageLength) } : {}),
          ...(expression.fixedWidthStorageStart ? { fixedWidthStorageStart: rewrite(expression.fixedWidthStorageStart) } : {})
        };
      }
      case "function-call":
        return { ...expression, args: expression.args.map(rewrite) };
      case "struct-field-access":
        return { ...expression, indices: expression.indices.map(rewrite) };
      case "parenthesized":
        return { ...expression, expression: rewrite(expression.expression) };
      case "unary":
        return { ...expression, operand: rewrite(expression.operand) };
      case "binary":
        return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
      case "identifier":
      case "number":
      case "string":
      case "boolean":
      case "color":
        return expression;
    }
  };

  const result: Instruction[] = [];
  for (const instruction of instructions) {
    if (instruction.kind === "dim-array") {
      const field = packedFields.get(instruction.name.toLowerCase());
      if (field) {
        if (field.column === 0) {
          result.push({
            ...instruction,
            name: field.name,
            dimensions: [instruction.dimensions[0], field.count],
            packedStructFields: packedFieldNames.get(field.name),
            structFieldName: undefined
          });
        }
        continue;
      }
    }
    const rewritten = mapInstructionExpressions(instruction, rewrite);
    if (rewritten.kind === "array-let") {
      const field = packedFields.get(rewritten.name.toLowerCase());
      if (field) {
        result.push({ ...rewritten, name: field.name, indices: [...rewritten.indices, columnExpression(field.column, rewritten.location)] });
        continue;
      }
    }
    result.push(rewritten);
  }
  return result;
}

function columnExpression(column: number, location: Expression["location"]): Expression {
  return { kind: "number", value: column, raw: column.toString(), location };
}
