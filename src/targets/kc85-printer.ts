import type { Expression, SourceLocation } from "../ast.js";
import { DiagnosticError } from "../diagnostics.js";
import { normalizeLabel, type Instruction, type LoweredProgram } from "../lowering.js";
import { isStringVariableName } from "../variables.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { rebuildLabels } from "./target.js";

/** Lower printer output to the M021 Centronics port, one byte at a time. */
export function lowerKc85Printer(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBKC85PRINTER");
  const allocateString = createGeneratedVariableNameAllocator(program.instructions, "MBKC85PRINTER", "$");
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let serial = 0;
  const freshLabel = (): string => {
    let name: string;
    do { name = `__mb_kc85_printer_${serial++}`; } while (labels.has(normalizeLabel(name)));
    labels.add(normalizeLabel(name));
    return name;
  };
  const byteName = allocate(), initialized = allocate(), index = allocate(), text = allocateString();
  const send = freshLabel(), ready = freshLabel(), normal = freshLabel(), done = freshLabel();
  let used = false;
  const printer = (device: string): boolean => device === "printer" || device === "text-printer";
  const n = (value: number, location: SourceLocation): Expression => ({ kind: "number", value, raw: String(value), location });
  const id = (name: string, location: SourceLocation): Expression => ({ kind: "identifier", name, location });
  const call = (name: string, args: readonly Expression[], valueType: "string" | "number", location: SourceLocation): Expression => ({ kind: "function-call", name, args, valueType, location });
  const compare = (left: Expression, operator: "=" | "<>", right: Expression, location: SourceLocation): Expression => ({ kind: "binary", operator, left, right, location });
  const emitByte = (value: Expression, location: SourceLocation): Instruction[] => [
    { kind: "let", name: byteName, expression: value, location }, { kind: "gosub", label: send, location }
  ];
  const instructions: Instruction[] = [];
  for (const instruction of program.instructions) {
    const location = instruction.location;
    if (instruction.kind === "check-device") {
      instructions.push({ kind: "let", name: instruction.name, sourceName: instruction.sourceName, expression: n(printer(instruction.device) ? 1 : 0, location), location });
    } else if (instruction.kind === "open-device") {
      if (!printer(instruction.device)) throw new DiagnosticError(location, `KC 85 does not support the ${instruction.device} device.`);
      used = true;
    } else if (instruction.kind === "close-device") {
      // The M021 has no native open or close operation.
    } else if (instruction.kind === "print-device") {
      used = true;
      for (const item of instruction.items) {
        const skip = freshLabel();
        const value = isString(item) ? item : call("STR$", [item], "string", location);
        const length = call("LEN", [id(text, location)], "number", location);
        const character = call("ASC", [call("MID$", [id(text, location), id(index, location), n(1, location)], "string", location)], "number", location);
        instructions.push(
          { kind: "let", name: text, expression: value, location },
          { kind: "if-goto", condition: compare(length, "=", n(0, location), location), label: skip, location },
          { kind: "for", variable: index, start: n(1, location), limit: length, location },
          ...emitByte(character, location),
          { kind: "next", variable: index, location },
          { kind: "label", name: skip, internal: true, location }
        );
      }
      if (!instruction.trailingSemicolon) instructions.push(...emitByte(n(13, location), location), ...emitByte(n(10, location), location));
    } else instructions.push(instruction);
  }
  if (!used) return rebuildLabels(program, instructions);
  const location = program.instructions[0].location;
  instructions.push(
    { kind: "goto", label: done, location },
    { kind: "label", name: send, internal: true, location },
    { kind: "if-goto", condition: compare(id(initialized, location), "<>", n(0, location), location), label: normal, location },
    { kind: "port-out", port: 147, value: n(15, location), location },
    // Set the inactive strobe latch before switching port A to bit mode. This
    // avoids a spurious byte on first use and also works after BASIC RUN.
    { kind: "port-out", port: 144, value: n(128, location), location },
    { kind: "port-out", port: 146, value: n(207, location), location },
    { kind: "port-out", port: 146, value: n(127, location), location },
    { kind: "let", name: initialized, expression: n(1, location), location },
    { kind: "label", name: normal, internal: true, location },
    { kind: "label", name: ready, internal: true, location },
    { kind: "if-goto", condition: compare(call("__KC85_JOY_BIT", [call("__KC85_JOY_RAW", [], "number", location), n(64, location)], "number", location), "<>", n(0, location), location), label: ready, location },
    { kind: "port-out", port: 145, value: id(byteName, location), location },
    { kind: "port-out", port: 144, value: n(0, location), location },
    { kind: "port-out", port: 144, value: n(128, location), location },
    { kind: "return", location },
    { kind: "label", name: done, internal: true, location }
  );
  return rebuildLabels(program, instructions);
}

function isString(value: Expression): boolean {
  switch (value.kind) {
    case "string": return true;
    case "identifier": return isStringVariableName(value.name);
    case "array-access": case "function-call": return value.valueType === "string" || isStringVariableName(value.name);
    case "struct-field-access": return value.valueType === "string" || isStringVariableName(value.field);
    case "parenthesized": return isString(value.expression);
    case "binary": return value.operator === "+" && (isString(value.left) || isString(value.right));
    default: return false;
  }
}
