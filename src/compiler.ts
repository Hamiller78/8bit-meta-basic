import { assignLineNumbers, type ReadabilityLevel } from "./line-numbering.js";
import { lowerProgram } from "./lowering.js";
import { parseSource } from "./parser.js";
import { analyzeProgram } from "./semantic.js";
import { getTarget, type TargetId } from "./targets/index.js";
import { setC64RenderProgram } from "./targets/c64.js";
import { setAtariRenderProgram } from "./targets/atari800xl.js";
import { setSpectrumRenderProgram } from "./targets/spectrum.js";
import { targetEnvironments } from "./targets/environment.js";
import { renderCheckedLine } from "./targets/target.js";

export type Target = TargetId;

export interface CompileOptions {
  readonly filename: string;
  readonly target: Target;
  readonly readability?: ReadabilityLevel;
  readonly comments?: ReadabilityLevel;
}

export function compileSource(source: string, options: CompileOptions): string {
  const ast = parseSource(source, options.filename);
  return compileProgram(ast, options);
}

export function compileProgram(ast: ReturnType<typeof parseSource>, options: CompileOptions): string {
  const target = getTarget(options.target);
  const readability = options.readability ?? options.comments ?? 2;
  const analyzed = analyzeProgram(ast, targetEnvironments[options.target]);
  const lowered = lowerProgram(analyzed);
  const targetLowered = target.lower(lowered, readability);
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

  return `${lines.join("\n")}\n`;
}

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
