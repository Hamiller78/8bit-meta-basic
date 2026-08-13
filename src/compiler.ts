import { assignLineNumbers, type CommentLevel } from "./line-numbering.js";
import { lowerProgram } from "./lowering.js";
import { parseSource } from "./parser.js";
import { renderSpectrum } from "./targets/spectrum.js";

export type Target = "spectrum";

export interface CompileOptions {
  readonly filename: string;
  readonly target: Target;
  readonly comments?: CommentLevel;
}

export function compileSource(source: string, options: CompileOptions): string {
  const ast = parseSource(source, options.filename);
  const lowered = lowerProgram(ast);
  const numbered = assignLineNumbers(lowered, options.comments ?? 2);

  switch (options.target) {
    case "spectrum":
      return renderSpectrum(numbered);
  }
}
