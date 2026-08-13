import { assignLineNumbers } from "./line-numbering.js";
import { lowerProgram } from "./lowering.js";
import { parseSource } from "./parser.js";
import { renderSpectrum } from "./targets/spectrum.js";

export type Target = "spectrum";

export interface CompileOptions {
  readonly filename: string;
  readonly target: Target;
}

export function compileSource(source: string, options: CompileOptions): string {
  const ast = parseSource(source, options.filename);
  const lowered = lowerProgram(ast);
  const numbered = assignLineNumbers(lowered);

  switch (options.target) {
    case "spectrum":
      return renderSpectrum(numbered);
  }
}
