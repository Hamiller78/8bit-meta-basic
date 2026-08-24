import type { SourceLocation } from "./ast.js";

export class DiagnosticError extends Error {
  readonly location: SourceLocation;

  constructor(location: SourceLocation, message: string) {
    super(`${formatLocation(location)}: ${message}`);
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

function formatLocation(location: SourceLocation): string {
  return location.column === undefined ? `${location.filename}:${location.line}` : `${location.filename}:${location.line}:${location.column}`;
}
