export const builtinFunctions = {
  abs: "ABS",
  atn: "ATN",
  chr: "CHR$",
  code: "CODE",
  cos: "COS",
  exp: "EXP",
  int: "INT",
  jiffies: "JIFFIES",
  keyCode: "KEY_CODE",
  len: "LEN",
  mid: "MID$",
  rnd: "RND",
  sgn: "SGN",
  sin: "SIN",
  space: "SPACE$",
  sqr: "SQR",
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
  return (
    canonical === builtinFunctions.chr ||
    canonical === builtinFunctions.mid ||
    canonical === builtinFunctions.space ||
    canonical === builtinFunctions.string
  );
}
