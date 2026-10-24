import type { Expression, FileArray, SourceLocation } from "../ast.js";
import { DiagnosticError } from "../diagnostics.js";
import type { FileStorage } from "../file-storage.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { rebuildLabels } from "./target.js";

let selectedFileStorage: FileStorage = "disk";
export function setFileStorage(storage: FileStorage): void { selectedFileStorage = storage; }

export function lowerSequentialFileIo(program: LoweredProgram, storage: FileStorage = selectedFileStorage): LoweredProgram {
  const output: Instruction[] = [];
  let serial = 0;
  for (const instruction of program.instructions) {
    if (instruction.kind === "delete-file") {
      if (storage === "tape") {
        throw new DiagnosticError(instruction.location, "DELETE_FILE is not available for tape storage because tape has no file directory.");
      }
      output.push({ kind: "delete-data-file", filename: instruction.filename, location: instruction.location });
      continue;
    }
    if (instruction.kind !== "save-file" && instruction.kind !== "load-file") {
      output.push(instruction);
      continue;
    }
    serial += 1;
    const writing = instruction.kind === "save-file";
    output.push({ kind: "open-data-file", mode: writing ? "write" : "read", filename: instruction.filename, storage, location: instruction.location });
    instruction.arrays.forEach((array, fieldIndex) => {
      output.push(...lowerArray(array, writing, serial, fieldIndex, instruction.location));
    });
    output.push({ kind: "close-data-file", location: instruction.location });
  }
  return rebuildLabels(program, output);
}

export function lowerSpectrumFileIo(program: LoweredProgram): LoweredProgram {
  const deleteInstruction = program.instructions.find(
    (instruction): instruction is Extract<Instruction, { kind: "delete-file" }> => instruction.kind === "delete-file"
  );
  if (deleteInstruction) {
    throw new DiagnosticError(deleteInstruction.location, "DELETE_FILE is not available for Spectrum tape storage because tape has no file directory.");
  }
  const fileInstructions = program.instructions.filter(
    (instruction): instruction is Extract<Instruction, { kind: "save-file" | "load-file" }> =>
      instruction.kind === "save-file" || instruction.kind === "load-file"
  );
  if (fileInstructions.length === 0) return program;

  const bufferSize = Math.max(...fileInstructions.map((instruction) => spectrumPackedSize(instruction.arrays)));
  const bufferName = uniqueInstructionName(program.instructions, "MBFILEBUFFER");
  const pointer = uniqueInstructionName(program.instructions, "MBFILEPOINTER");
  const text = uniqueInstructionName(program.instructions, "MBFILETEXT$");
  const length = uniqueInstructionName(program.instructions, "MBFILELENGTH");
  const elementIndex = uniqueInstructionName(program.instructions, "MBFILEINDEX");
  const characterIndex = uniqueInstructionName(program.instructions, "MBFILECHAR");
  const output: Instruction[] = [];
  const firstLocation = fileInstructions[0].location;
  output.push({
    kind: "dim-array",
    name: bufferName,
    dimensions: [bufferSize],
    storageType: "byte",
    skipByteInitialization: true,
    location: firstLocation
  });

  let serial = 0;
  for (const instruction of program.instructions) {
    if (instruction.kind !== "save-file" && instruction.kind !== "load-file") {
      output.push(instruction);
      continue;
    }
    serial += 1;
    output.push({ kind: "let", name: pointer, expression: num(0, instruction.location), location: instruction.location });
    if (instruction.kind === "save-file") {
      output.push(...packSpectrumArrays(instruction.arrays, bufferName, pointer, text, elementIndex, characterIndex, serial, instruction.location));
      output.push({
        kind: "save-native-array",
        filename: instruction.filename,
        array: { name: bufferName, valueType: "byte", dimensions: [bufferSize], sourceName: instruction.arrays[0]?.sourceName ?? bufferName },
        location: instruction.location
      });
    } else {
      output.push({
        kind: "load-native-array",
        filename: instruction.filename,
        array: { name: bufferName, valueType: "byte", dimensions: [bufferSize], sourceName: instruction.arrays[0]?.sourceName ?? bufferName },
        location: instruction.location
      });
      output.push(...unpackSpectrumArrays(instruction.arrays, bufferName, pointer, text, length, elementIndex, characterIndex, serial, instruction.location));
    }
  }
  return rebuildLabels(program, output);
}

const spectrumNumberTextWidth = 16;

function spectrumPackedSize(arrays: readonly FileArray[]): number {
  return arrays.reduce((total, array) => {
    const count = array.dimensions[0];
    if (array.valueType === "byte") return total + count;
    const width = array.valueType === "string" ? array.dimensions[1] : spectrumNumberTextWidth;
    return total + count * (width + 1);
  }, 0);
}

function packSpectrumArrays(
  arrays: readonly FileArray[],
  bufferName: string,
  pointer: string,
  text: string,
  elementIndex: string,
  characterIndex: string,
  serial: number,
  location: SourceLocation
): Instruction[] {
  const result: Instruction[] = [];
  arrays.forEach((array, fieldIndex) => {
    const element = arrayAccess(array.name, id(elementIndex, location), location, array.valueType);
    result.push(forInstruction(elementIndex, 0, array.dimensions[0] - 1, location));
    if (array.valueType === "byte") {
      result.push(byteArrayLet(bufferName, pointer, element, location), increment(pointer, location));
    } else {
      const source = array.valueType === "string" ? element : call("STR$", [element], location);
      const done = `__mb_spectrum_pack_${serial}_${fieldIndex}`;
      result.push({ kind: "let", name: text, expression: source, location });
      result.push(byteArrayLet(bufferName, pointer, call("LEN", [id(text, location)], location), location), increment(pointer, location));
      result.push({
        kind: "if-goto",
        condition: binary("=", call("LEN", [id(text, location)], location), num(0, location), location),
        label: done,
        location
      });
      result.push({ kind: "for", variable: characterIndex, start: num(1, location), limit: call("LEN", [id(text, location)], location), step: num(1, location), location });
      result.push(
        byteArrayLet(bufferName, pointer, call("CODE", [call("MID$", [id(text, location), id(characterIndex, location), num(1, location)], location)], location), location),
        increment(pointer, location),
        { kind: "next", variable: characterIndex, location },
        { kind: "label", name: done, internal: true, location }
      );
    }
    result.push({ kind: "next", variable: elementIndex, location });
  });
  return result;
}

function unpackSpectrumArrays(
  arrays: readonly FileArray[],
  bufferName: string,
  pointer: string,
  text: string,
  length: string,
  elementIndex: string,
  characterIndex: string,
  serial: number,
  location: SourceLocation
): Instruction[] {
  const result: Instruction[] = [];
  arrays.forEach((array, fieldIndex) => {
    result.push(forInstruction(elementIndex, 0, array.dimensions[0] - 1, location));
    if (array.valueType === "byte") {
      result.push({ kind: "array-let", name: array.name, indices: [id(elementIndex, location)], expression: byteArrayAccess(bufferName, pointer, location), storageType: "byte", location });
      result.push(increment(pointer, location));
    } else {
      const done = `__mb_spectrum_unpack_${serial}_${fieldIndex}`;
      result.push({ kind: "let", name: length, expression: byteArrayAccess(bufferName, pointer, location), location });
      result.push(increment(pointer, location), { kind: "let", name: text, expression: { kind: "string", value: "", location }, location });
      result.push({ kind: "if-goto", condition: binary("=", id(length, location), num(0, location), location), label: done, location });
      result.push({ kind: "for", variable: characterIndex, start: num(1, location), limit: id(length, location), step: num(1, location), location });
      result.push(
        { kind: "let", name: text, expression: binary("+", id(text, location), call("CHR$", [byteArrayAccess(bufferName, pointer, location)], location), location), location },
        increment(pointer, location),
        { kind: "next", variable: characterIndex, location },
        { kind: "label", name: done, internal: true, location }
      );
      result.push(array.valueType === "string"
        ? { kind: "array-let", name: array.name, indices: [id(elementIndex, location)], expression: id(text, location), location }
        : { kind: "array-let", name: array.name, indices: [id(elementIndex, location)], expression: call("VAL", [id(text, location)], location), location });
    }
    result.push({ kind: "next", variable: elementIndex, location });
  });
  return result;
}

function uniqueInstructionName(instructions: readonly Instruction[], stem: string): string {
  const haystack = JSON.stringify(instructions).toLowerCase();
  let suffix = 0;
  while (true) {
    const candidate = `${stem}${suffix === 0 ? "" : suffix}`;
    if (!haystack.includes(`\"${candidate.toLowerCase()}\"`)) return candidate;
    suffix += 1;
  }
}

function byteArrayLet(name: string, pointer: string, expression: Expression, location: SourceLocation): Instruction {
  return { kind: "array-let", name, indices: [id(pointer, location)], expression, storageType: "byte", location };
}

function byteArrayAccess(name: string, pointer: string, location: SourceLocation): Expression {
  return { kind: "array-access", name, indices: [id(pointer, location)], valueType: "byte", location };
}

function increment(name: string, location: SourceLocation): Instruction {
  return { kind: "let", name, expression: binary("+", id(name, location), num(1, location), location), location };
}

function binary(operator: "+" | "=", left: Expression, right: Expression, location: SourceLocation): Expression {
  return { kind: "binary", operator, left, right, location };
}

function lowerArray(array: FileArray, writing: boolean, serial: number, fieldIndex: number, location: SourceLocation): Instruction[] {
  const count = array.dimensions[0];
  const index = `MBFILEI${serial}_${fieldIndex}`;
  const charIndex = `MBFILEJ${serial}_${fieldIndex}`;
  const value = `MBFILEV${serial}_${fieldIndex}`;
  const charactersDone = `__mb_file_chars_${serial}_${fieldIndex}`;
  const element = arrayAccess(array.name, id(index, location), location);
  const result: Instruction[] = [forInstruction(index, 0, count - 1, location)];
  if (array.valueType !== "string") {
    result.push(writing
      ? { kind: "write-data-file", expression: element, location }
      : { kind: "read-data-file", target: element, location });
    result.push({ kind: "next", variable: index, location });
    return result;
  }
  if (writing) {
    result.push({ kind: "write-data-file", expression: call("LEN", [element], location), location });
    result.push({ kind: "if-goto", condition: { kind: "binary", operator: "=", left: call("LEN", [element], location), right: num(0, location), location }, label: charactersDone, location });
    result.push({ kind: "for", variable: charIndex, start: num(1, location), limit: call("LEN", [element], location), step: num(1, location), location });
    result.push({ kind: "write-data-file", expression: call("CODE", [call("MID$", [element, id(charIndex, location), num(1, location)], location)], location), location });
    result.push({ kind: "next", variable: charIndex, location });
  } else {
    result.push({ kind: "read-data-file", target: id(value, location), location });
    result.push({ kind: "array-let", name: array.name, indices: [id(index, location)], expression: { kind: "string", value: "", location }, location });
    result.push({ kind: "if-goto", condition: { kind: "binary", operator: "=", left: id(value, location), right: num(0, location), location }, label: charactersDone, location });
    result.push({ kind: "for", variable: charIndex, start: num(1, location), limit: id(value, location), step: num(1, location), location });
    result.push({ kind: "read-data-file", target: id(value + "C", location), location });
    result.push({ kind: "array-let", name: array.name, indices: [id(index, location)], expression: { kind: "binary", operator: "+", left: element, right: call("CHR$", [id(value + "C", location)], location), location }, location });
    result.push({ kind: "next", variable: charIndex, location });
  }
  result.push({ kind: "label", name: charactersDone, internal: true, location });
  result.push({ kind: "next", variable: index, location });
  return result;
}

function num(value: number, location: SourceLocation): Expression { return { kind: "number", value, raw: String(value), location }; }
function id(name: string, location: SourceLocation): Expression { return { kind: "identifier", name, location }; }
function call(name: string, args: readonly Expression[], location: SourceLocation): Expression { return { kind: "function-call", name, args, location }; }
function arrayAccess(name: string, index: Expression, location: SourceLocation, valueType?: FileArray["valueType"]): Expression {
  return { kind: "array-access", name, indices: [index], ...(valueType ? { valueType } : {}), location };
}
function forInstruction(variable: string, start: number, limit: number, location: SourceLocation): Extract<Instruction, { kind: "for" }> {
  return { kind: "for", variable, start: num(start, location), limit: num(limit, location), step: num(1, location), location };
}
