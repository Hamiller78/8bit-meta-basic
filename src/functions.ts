export const builtinFunctions = {
  abs: "ABS",
  asc: "ASC",
  atn: "ATN",
  chr: "CHR$",
  code: "CODE",
  cos: "COS",
  deviceAvailable: "DEVICE_AVAILABLE",
  exp: "EXP",
  freeMemory: "FREE_MEMORY",
  int: "INT",
  jiffies: "JIFFIES",
  keyCode: "KEY_CODE",
  left: "LEFT$",
  len: "LEN",
  mid: "MID$",
  rnd: "RND",
  right: "RIGHT$",
  sgn: "SGN",
  sin: "SIN",
  space: "SPACE$",
  sqr: "SQR",
  str: "STR$",
  val: "VAL",
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
    canonical === builtinFunctions.left ||
    canonical === builtinFunctions.mid ||
    canonical === builtinFunctions.right ||
    canonical === builtinFunctions.space ||
    canonical === builtinFunctions.str ||
    canonical === builtinFunctions.string
  );
}
