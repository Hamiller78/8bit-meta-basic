// KC 85/3 HC-BASIC token values, in byte order 0x80..0xF4.
const tokens = [
  "END", "FOR", "NEXT", "DATA", "INPUT", "DIM", "READ", "LET", "GOTO", "RUN", "IF", "RESTORE", "GOSUB", "RETURN", "REM", "STOP",
  "OUT", "ON", "NULL", "WAIT", "DEF", "POKE", "DOKE", "AUTO", "LINES", "CLS", "WIDTH", "BYE", "!", "CALL", "PRINT", "CONT",
  "LIST", "CLEAR", "CLOAD", "CSAVE", "NEW", "TAB(", "TO", "FN", "SPC(", "THEN", "NOT", "STEP", "+", "-", "*", "/", "^",
  "AND", "OR", ">", "=", "<", "SGN", "INT", "ABS", "USR", "FRE", "INP", "POS", "SQR", "RND", "LN", "EXP", "COS",
  "SIN", "TAN", "ATN", "PEEK", "DEEK", "PI", "LEN", "STR$", "VAL", "ASC", "CHR$", "LEFT$", "RIGHT$", "MID$", "LOAD", "TRON",
  "TROFF", "EDIT", "ELSE", "INKEY$", "JOYST", "STRING$", "INSTR", "RENUMBER", "DELETE", "PAUSE", "BEEP", "WINDOW", "BORDER", "INK", "PAPER", "AT",
  "COLOR", "SOUND", "PSET", "PRESET", "BLOAD", "VPEEK", "VPOKE", "LOCATE", "KEYLIST", "KEY", "SWITCH", "PTEST", "CLOSE", "OPEN", "RANDOMIZE", "VGET$",
  "LINE", "CIRCLE", "CSRLIN"
];

/** Encode a KC 85/3 listing as JKCEMU's headerless KC-BASIC .sss format. */
export function tokenizeKc85Basic(listing) {
  const lines = listing.replace(/\r\n?/gu, "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error("The KC 85 BASIC listing is empty.");
  const encoded = [];
  let previousLine = -1;
  let address = 0x0401;
  for (const line of lines) {
    const match = /^(\d+) (.*)$/u.exec(line);
    if (!match || /[^\x20-\x7eäöüß]/u.test(line) || line.length > 72) throw new Error("KC 85 BASIC requires numbered ASCII lines (with supported KC characters in strings) of at most 72 characters.");
    const number = Number(match[1]);
    if (number <= previousLine || number > 65529) throw new Error("KC 85 BASIC line numbers must increase and not exceed 65529.");
    previousLine = number;
    const body = tokenizeLine(match[2]);
    const next = address + body.length + 5;
    if (next > 0xffff) throw new Error("KC 85 BASIC program exceeds its address space.");
    encoded.push(next & 255, next >> 8, number & 255, number >> 8, ...body, 0);
    address = next;
  }
  encoded.push(0, 0);
  if (encoded.length > 65535) throw new Error("KC 85 BASIC program exceeds the .sss length limit.");
  const length = encoded.length;
  const totalLength = Math.ceil((length + 3) / 128) * 128;
  const result = Buffer.alloc(totalLength);
  result.writeUInt16LE(length, 0);
  Buffer.from(encoded).copy(result, 2);
  result[length + 2] = 3;
  return result;
}

function tokenizeLine(line) {
  const result = [];
  const international = new Map([["ä", 0x7b], ["ö", 0x7c], ["ü", 0x7d], ["ß", 0x7e]]);
  let state = "code";
  for (let index = 0; index < line.length;) {
    const character = line[index];
    if (character === '"' && state !== "rem") {
      state = state === "string" ? "code" : state === "data-string" ? "data" : state === "data" ? "data-string" : "string";
      result.push(character.charCodeAt(0));
      index += 1;
      continue;
    }
    if (state === "code") {
      const remaining = line.slice(index).toUpperCase();
      const token = tokens.findIndex((candidate) => remaining.startsWith(candidate));
      if (token >= 0) {
        result.push(0x80 + token);
        index += tokens[token].length;
        if (tokens[token] === "REM") state = "rem";
        else if (tokens[token] === "DATA") state = "data";
        continue;
      }
    }
    const mapped = international.get(character);
    if (mapped !== undefined) {
      if (state !== "string" && state !== "data-string" && state !== "rem") throw new Error("KC 85 international characters are supported only in BASIC strings and comments.");
      result.push(mapped);
      index += 1;
      continue;
    }
    if (state === "data" && character === ":") state = "code";
    result.push(character.charCodeAt(0));
    index += 1;
  }
  return result;
}
