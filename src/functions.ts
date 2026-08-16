export const builtinFunctions = {
  len: "LEN",
  mid: "MID$",
  space: "SPACE$",
  string: "STRING$"
} as const;

export type BuiltinFunctionName = (typeof builtinFunctions)[keyof typeof builtinFunctions];

export function canonicalFunctionName(name: string): BuiltinFunctionName | undefined {
  const upper = name.toUpperCase();
  for (const functionName of Object.values(builtinFunctions)) {
    if (upper === functionName) {
      return functionName;
    }
  }

  return undefined;
}

export function isStringFunctionName(name: string): boolean {
  const canonical = canonicalFunctionName(name);
  return canonical === builtinFunctions.mid || canonical === builtinFunctions.space || canonical === builtinFunctions.string;
}
