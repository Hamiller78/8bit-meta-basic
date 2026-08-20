export function isStringVariableName(name: string): boolean {
  return name.endsWith("$");
}

export function isIntegerVariableName(name: string): boolean {
  return name.endsWith("%");
}

export function baseVariableName(name: string): string {
  return name.replace(/[$%]$/, "");
}
