import type { SourceLocation } from "./ast.js";

export class DiagnosticError extends Error {
  readonly location: SourceLocation;

  constructor(location: SourceLocation, message: string) {
    super(`${location.filename}:${location.line}: ${message}`);
    this.name = "DiagnosticError";
    this.location = location;
  }
}

export function formatCause(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
