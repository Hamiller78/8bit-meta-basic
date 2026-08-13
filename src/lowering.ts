import type { Program, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";

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

export type Instruction = LabelInstruction | PrintInstruction | GotoInstruction | IfGotoInstruction;

export interface LabelInstruction {
  readonly kind: "label";
  readonly name: string;
  readonly internal: boolean;
  readonly location: SourceLocation;
}

export interface PrintInstruction {
  readonly kind: "print";
  readonly literal: string;
  readonly location: SourceLocation;
}

export interface GotoInstruction {
  readonly kind: "goto";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface IfGotoInstruction {
  readonly kind: "if-goto";
  readonly condition: string;
  readonly label: string;
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
      case "label":
        instructions.push({ kind: "label", name: statement.name, internal: false, location: statement.location });
        break;
      case "print":
        instructions.push({ kind: "print", literal: statement.literal, location: statement.location });
        break;
      case "goto":
        instructions.push({ kind: "goto", label: statement.label, location: statement.location });
        break;
      case "if": {
        const thenLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();
        const elseLabel = statement.elseBranch.length > 0 ? nextInternalLabel() : endLabel;

        instructions.push({ kind: "if-goto", condition: statement.condition, label: thenLabel, location: statement.location });
        instructions.push({ kind: "goto", label: elseLabel, location: statement.location });
        instructions.push({ kind: "label", name: thenLabel, internal: true, location: statement.location });
        lowerStatements(statement.thenBranch, instructions, nextInternalLabel);

        if (statement.elseBranch.length > 0) {
          instructions.push({ kind: "goto", label: endLabel, location: statement.location });
          instructions.push({ kind: "label", name: elseLabel, internal: true, location: statement.location });
          lowerStatements(statement.elseBranch, instructions, nextInternalLabel);
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
    if (instruction.kind !== "goto" && instruction.kind !== "if-goto") {
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
  return label.toLowerCase();
}
