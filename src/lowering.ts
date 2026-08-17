import type { Expression, Program, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { normalizeName } from "./symbols.js";

export interface LoweredProgram {
  readonly instructions: readonly Instruction[];
  readonly labels: ReadonlyMap<string, LabelDefinition>;
}

export interface LabelDefinition {
  readonly name: string;
  readonly index: number;
  readonly location: SourceLocation;
  readonly internal: boolean;
}

export type Instruction =
  | LabelInstruction
  | RemInstruction
  | ClsInstruction
  | BorderColorInstruction
  | TextColorInstruction
  | ScreenBackgroundColorInstruction
  | CellTextColorInstruction
  | CellBackgroundColorInstruction
  | PaperInstruction
  | PrintInstruction
  | LetInstruction
  | GotoInstruction
  | GosubInstruction
  | ReturnInstruction
  | ForInstruction
  | NextInstruction
  | IfGotoInstruction
  | PositionInstruction
  | SetColorInstruction
  | PokeInstruction
  | PrintChrInstruction
  | DimStringInstruction
  | SysInstruction;

export interface LabelInstruction {
  readonly kind: "label";
  readonly name: string;
  readonly internal: boolean;
  readonly location: SourceLocation;
}

export interface RemInstruction {
  readonly kind: "rem";
  readonly text: string;
  readonly location: SourceLocation;
}

export interface ClsInstruction {
  readonly kind: "cls";
  readonly color?: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface BorderColorInstruction {
  readonly kind: "border-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface TextColorInstruction {
  readonly kind: "text-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface ScreenBackgroundColorInstruction {
  readonly kind: "screen-background-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface CellTextColorInstruction {
  readonly kind: "cell-text-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface CellBackgroundColorInstruction {
  readonly kind: "cell-background-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface PaperInstruction {
  readonly kind: "paper";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface PrintInstruction {
  readonly kind: "print";
  readonly items: readonly Expression[];
  readonly trailingSemicolon: boolean;
  readonly at?: {
    readonly row: Expression;
    readonly column: Expression;
  };
  readonly location: SourceLocation;
}

export interface LetInstruction {
  readonly kind: "let";
  readonly name: string;
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface GotoInstruction {
  readonly kind: "goto";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface GosubInstruction {
  readonly kind: "gosub";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface ReturnInstruction {
  readonly kind: "return";
  readonly location: SourceLocation;
}

export interface ForInstruction {
  readonly kind: "for";
  readonly variable: string;
  readonly start: Expression;
  readonly limit: Expression;
  readonly step?: Expression;
  readonly location: SourceLocation;
}

export interface NextInstruction {
  readonly kind: "next";
  readonly variable: string;
  readonly location: SourceLocation;
}

export interface IfGotoInstruction {
  readonly kind: "if-goto";
  readonly condition: Expression;
  readonly label: string;
  readonly location: SourceLocation;
}

export interface PositionInstruction {
  readonly kind: "position";
  readonly row: Expression;
  readonly column: Expression;
  readonly location: SourceLocation;
}

export interface SetColorInstruction {
  readonly kind: "setcolor";
  readonly register: number;
  readonly hue: number;
  readonly luminance: number;
  readonly location: SourceLocation;
}

export interface PokeInstruction {
  readonly kind: "poke";
  readonly address: number;
  readonly value: Expression;
  readonly location: SourceLocation;
}

export interface PrintChrInstruction {
  readonly kind: "print-chr";
  readonly code: number;
  readonly trailingSemicolon: boolean;
  readonly location: SourceLocation;
}

export interface DimStringInstruction {
  readonly kind: "dim-string";
  readonly name: string;
  readonly length: number;
  readonly location: SourceLocation;
}

export interface SysInstruction {
  readonly kind: "sys";
  readonly address: number;
  readonly location: SourceLocation;
}

export function lowerProgram(program: Program): LoweredProgram {
  const userLabels = collectUserLabels(program.statements);
  const generator = internalLabelGenerator(userLabels);
  const instructions: Instruction[] = [];

  lowerStatements(program.statements, instructions, generator);

  const labels = buildLabelMap(instructions);
  validateReferences(instructions, labels);

  return { instructions, labels };
}

function lowerStatements(
  statements: readonly Statement[],
  instructions: Instruction[],
  nextInternalLabel: () => string
): void {
  for (const statement of statements) {
    switch (statement.kind) {
      case "const":
        break;
      case "cls":
        instructions.push({
          kind: "cls",
          ...(statement.color ? { color: statement.color as Extract<Expression, { kind: "color" }> } : {}),
          location: statement.location
        });
        break;
      case "border-color":
        instructions.push({
          kind: "border-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "text-color":
        instructions.push({
          kind: "text-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "screen-background-color":
        instructions.push({
          kind: "screen-background-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "cell-text-color":
        instructions.push({
          kind: "cell-text-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "cell-background-color":
        instructions.push({
          kind: "cell-background-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "label":
        instructions.push({ kind: "label", name: statement.name, internal: false, location: statement.location });
        break;
      case "print":
        instructions.push({
          kind: "print",
          items: statement.items,
          trailingSemicolon: statement.trailingSemicolon,
          ...(statement.at ? { at: { row: statement.at.row, column: statement.at.column } } : {}),
          location: statement.location
        });
        break;
      case "let":
        instructions.push({ kind: "let", name: statement.name, expression: statement.expression, location: statement.location });
        break;
      case "goto":
        instructions.push({ kind: "goto", label: statement.label, location: statement.location });
        break;
      case "gosub":
        instructions.push({ kind: "gosub", label: statement.label, location: statement.location });
        break;
      case "return":
        instructions.push({ kind: "return", location: statement.location });
        break;
      case "for":
        instructions.push({
          kind: "for",
          variable: statement.variable,
          start: statement.start,
          limit: statement.limit,
          ...(statement.step ? { step: statement.step } : {}),
          location: statement.location
        });
        lowerStatements(statement.body, instructions, nextInternalLabel);
        instructions.push({ kind: "next", variable: statement.variable, location: statement.location });
        break;
      case "if": {
        const thenLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();

        if (statement.elseBranch.length > 0) {
          instructions.push({ kind: "if-goto", condition: statement.condition, label: thenLabel, location: statement.location });
          lowerStatements(statement.elseBranch, instructions, nextInternalLabel);
          instructions.push({ kind: "goto", label: endLabel, location: statement.location });
          instructions.push({ kind: "label", name: thenLabel, internal: true, location: statement.location });
          lowerStatements(statement.thenBranch, instructions, nextInternalLabel);
        } else {
          instructions.push({ kind: "if-goto", condition: statement.condition, label: thenLabel, location: statement.location });
          instructions.push({ kind: "goto", label: endLabel, location: statement.location });
          instructions.push({ kind: "label", name: thenLabel, internal: true, location: statement.location });
          lowerStatements(statement.thenBranch, instructions, nextInternalLabel);
        }

        instructions.push({ kind: "label", name: endLabel, internal: true, location: statement.location });
        break;
      }
    }
  }
}

function collectUserLabels(statements: readonly Statement[], seen = new Map<string, SourceLocation>()): ReadonlySet<string> {
  for (const statement of statements) {
    if (statement.kind === "label") {
      const key = normalizeLabel(statement.name);
      const existing = seen.get(key);
      if (existing) {
        throw new DiagnosticError(statement.location, `Duplicate label "${statement.name}" first defined at ${existing.filename}:${existing.line}.`);
      }
      seen.set(key, statement.location);
      continue;
    }

    if (statement.kind === "if") {
      collectUserLabels(statement.thenBranch, seen);
      collectUserLabels(statement.elseBranch, seen);
    } else if (statement.kind === "for") {
      collectUserLabels(statement.body, seen);
    }
  }

  return new Set(seen.keys());
}

function buildLabelMap(instructions: readonly Instruction[]): ReadonlyMap<string, LabelDefinition> {
  const labels = new Map<string, LabelDefinition>();

  instructions.forEach((instruction, index) => {
    if (instruction.kind !== "label") {
      return;
    }

    const key = normalizeLabel(instruction.name);
    if (labels.has(key)) {
      throw new DiagnosticError(instruction.location, `Duplicate label "${instruction.name}".`);
    }

    labels.set(key, {
      name: instruction.name,
      index,
      location: instruction.location,
      internal: instruction.internal
    });
  });

  return labels;
}

function validateReferences(instructions: readonly Instruction[], labels: ReadonlyMap<string, LabelDefinition>): void {
  for (const instruction of instructions) {
    if (instruction.kind !== "goto" && instruction.kind !== "gosub" && instruction.kind !== "if-goto") {
      continue;
    }

    if (!labels.has(normalizeLabel(instruction.label))) {
      throw new DiagnosticError(instruction.location, `Undefined label "${instruction.label}".`);
    }
  }
}

function internalLabelGenerator(userLabels: ReadonlySet<string>): () => string {
  let nextId = 1;
  const used = new Set(userLabels);

  return () => {
    while (true) {
      const candidate = `__mb_${nextId}`;
      nextId += 1;
      const key = normalizeLabel(candidate);
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
    }
  };
}

export function normalizeLabel(label: string): string {
  return normalizeName(label);
}
