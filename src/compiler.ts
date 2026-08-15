import { assignLineNumbers, type ReadabilityLevel } from "./line-numbering.js";
import { lowerProgram } from "./lowering.js";
import { parseSource } from "./parser.js";
import { analyzeProgram } from "./semantic.js";
import { getTarget, type TargetId } from "./targets/index.js";
import { setC64RenderProgram } from "./targets/c64.js";
import { setAtariRenderProgram } from "./targets/atari800xl.js";
import { setSpectrumRenderProgram } from "./targets/spectrum.js";
import { targetEnvironments } from "./targets/environment.js";

export type Target = TargetId;

export interface CompileOptions {
  readonly filename: string;
  readonly target: Target;
  readonly readability?: ReadabilityLevel;
  readonly comments?: ReadabilityLevel;
}

export function compileSource(source: string, options: CompileOptions): string {
  const ast = parseSource(source, options.filename);
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
  const numbered = assignLineNumbers(targetLowered, readability);

  return `${numbered.lines.map((line) => target.renderLine(line.number, line.instruction, numbered.labelLines, readability)).join("\n")}\n`;
}
