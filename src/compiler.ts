import { assignLineNumbers, type ReadabilityLevel } from "./line-numbering.js";
import { lowerProgram, type Instruction, type LoweredProgram } from "./lowering.js";
import { parseSource } from "./parser.js";
import { analyzeProgram } from "./semantic.js";
import { getTarget, type TargetId } from "./targets/index.js";
import { setC64RenderProgram } from "./targets/c64.js";
import { setAtariRenderProgram } from "./targets/atari800xl.js";
import { setSpectrumRenderProgram } from "./targets/spectrum.js";
import { targetEnvironments } from "./targets/environment.js";
import { rebuildLabels, renderCheckedLine } from "./targets/target.js";
import { analyzeBasicOutput, type OutputStats } from "./output-stats.js";

export type Target = TargetId;

export interface CompileOptions {
  readonly filename: string;
  readonly target: Target;
  readonly readability?: ReadabilityLevel;
  readonly comments?: ReadabilityLevel;
  readonly testMode?: boolean;
}

export interface CompileResult {
  readonly output: string;
  readonly stats: OutputStats;
}

export function compileSource(source: string, options: CompileOptions): string {
  return compileSourceDetailed(source, options).output;
}

export function compileSourceDetailed(source: string, options: CompileOptions): CompileResult {
  const ast = parseSource(source, options.filename);
  return compileProgramDetailed(ast, options);
}

export function compileProgram(ast: ReturnType<typeof parseSource>, options: CompileOptions): string {
  return compileProgramDetailed(ast, options).output;
}

export function compileProgramDetailed(ast: ReturnType<typeof parseSource>, options: CompileOptions): CompileResult {
  const target = getTarget(options.target);
  const readability = options.readability ?? options.comments ?? 2;
  const analyzed = analyzeProgram(ast, targetEnvironments[options.target], { testMode: options.testMode });
  const lowered = lowerProgram(analyzed, { testMode: options.testMode });
  const targetLowered = compactGeneratedHousekeepingLets(target.lower(lowered, readability));
  if (options.target === "spectrum") {
    setSpectrumRenderProgram(targetLowered.instructions);
  }
  if (options.target === "atari800xl") {
    setAtariRenderProgram(targetLowered.instructions);
  }
  if (options.target === "c64") {
    setC64RenderProgram(targetLowered.instructions);
  }
  const numbered = assignLineNumbers(targetLowered, readability, {
    maxLineNumber: target.maxLineNumber,
    targetName: targetDisplayName(options.target)
  });
  const lines = numbered.lines.map((line) => renderCheckedLine(target, line.number, line.instruction, numbered.labelLines, readability));

  return {
    output: `${lines.join("\n")}\n`,
    stats: analyzeBasicOutput(lines, options.target)
  };
}

function compactGeneratedHousekeepingLets(program: LoweredProgram): LoweredProgram {
  const instructions: Instruction[] = [];
  let index = 0;

  while (index < program.instructions.length) {
    const instruction = program.instructions[index];
    if (!isGeneratedHousekeepingLet(instruction)) {
      instructions.push(instruction);
      index += 1;
      continue;
    }

    const run: Extract<Instruction, { kind: "let" }>[] = [];
    while (index < program.instructions.length && run.length < 4 && isGeneratedHousekeepingLet(program.instructions[index])) {
      run.push(program.instructions[index] as Extract<Instruction, { kind: "let" }>);
      index += 1;
    }

    if (run.length === 1) {
      instructions.push(run[0]);
    } else {
      instructions.push({
        kind: "multi-let",
        assignments: run.map((assignment) => ({
          name: assignment.name,
          expression: assignment.expression,
          location: assignment.location
        })),
        location: run[0].location
      });
    }
  }

  return rebuildLabels(program, instructions);
}

function isGeneratedHousekeepingLet(instruction: Instruction | undefined): instruction is Extract<Instruction, { kind: "let" }> {
  return instruction?.kind === "let" && generatedHousekeepingNames.has(instruction.name.toUpperCase());
}

const generatedHousekeepingNames = new Set([
  "MBTOUT$",
  "MBTPOUT$",
  "MBTPROW",
  "MBTPCOL",
  "MBTCB",
  "MBTCG",
  "MBTCT",
  "MBTCC",
  "MBTCD",
  "MBTF0"
]);

function targetDisplayName(target: TargetId): string {
  switch (target) {
    case "spectrum":
      return "Spectrum";
    case "atari800xl":
      return "Atari 800XL";
    case "c64":
      return "C64";
  }
}
