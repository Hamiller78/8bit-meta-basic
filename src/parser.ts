import type { IfStatement, Program, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { removeLineComment } from "./lexer.js";

interface Frame {
  readonly ifLocation: SourceLocation;
  readonly condition: string;
  readonly parent: Statement[];
  readonly thenBranch: Statement[];
  readonly elseBranch: Statement[];
  inElse: boolean;
}

const labelPattern = /^([A-Za-z_][A-Za-z0-9_]*):$/;
const printPattern = /^print\s+("[^"]*")\s*$/i;
const gotoPattern = /^goto\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i;
const ifPattern = /^if\s+(.+)\s+then\s*$/i;
const elsePattern = /^else\s*$/i;
const endIfPattern = /^end\s+if\s*$/i;

export function parseSource(source: string, filename: string): Program {
  const root: Statement[] = [];
  const stack: Frame[] = [];
  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const location = { filename, line: index + 1 };
    const text = removeLineComment(lines[index] ?? "").trim();

    if (text.length === 0) {
      continue;
    }

    if (elsePattern.test(text)) {
      const frame = stack.at(-1);
      if (!frame) {
        throw new DiagnosticError(location, "Unexpected ELSE without matching IF.");
      }
      if (frame.inElse) {
        throw new DiagnosticError(location, "Unexpected duplicate ELSE in IF block.");
      }
      frame.inElse = true;
      continue;
    }

    if (endIfPattern.test(text)) {
      const frame = stack.pop();
      if (!frame) {
        throw new DiagnosticError(location, "Unexpected END IF without matching IF.");
      }

      frame.parent.push({
        kind: "if",
        condition: frame.condition,
        thenBranch: frame.thenBranch,
        elseBranch: frame.elseBranch,
        location: frame.ifLocation
      });
      continue;
    }

    const target = currentTarget(root, stack);
    const labelMatch = labelPattern.exec(text);
    if (labelMatch) {
      target.push({ kind: "label", name: labelMatch[1], location });
      continue;
    }

    const printMatch = printPattern.exec(text);
    if (printMatch) {
      target.push({ kind: "print", literal: printMatch[1], location });
      continue;
    }

    const gotoMatch = gotoPattern.exec(text);
    if (gotoMatch) {
      target.push({ kind: "goto", label: gotoMatch[1], location });
      continue;
    }

    const ifMatch = ifPattern.exec(text);
    if (ifMatch) {
      const condition = ifMatch[1].trim();
      if (condition.length === 0) {
        throw new DiagnosticError(location, "IF condition must not be empty.");
      }

      stack.push({
        ifLocation: location,
        condition,
        parent: target,
        thenBranch: [],
        elseBranch: [],
        inElse: false
      });
      continue;
    }

    throw new DiagnosticError(location, `Unsupported or invalid syntax: ${text}`);
  }

  const openFrame = stack.at(-1);
  if (openFrame) {
    throw new DiagnosticError(openFrame.ifLocation, "Missing END IF for IF block.");
  }

  return { statements: root };
}

function currentTarget(root: Statement[], stack: Frame[]): Statement[] {
  const frame = stack.at(-1);
  if (!frame) {
    return root;
  }

  return frame.inElse ? frame.elseBranch : frame.thenBranch;
}
