const LINE_NUMBER_TOKEN = 0x8d;
const CARRIAGE_RETURN = 0x0d;

// This is the KEYWDS table from Agon BBC BASIC ADL 1.03. Table order and
// delimiter flags matter: the interpreter searches it sequentially.
const keywords = [
  [0x80, "AND"], [0x94, "ABS"], [0x95, "ACS"], [0x96, "ADVAL"], [0x97, "ASC"],
  [0x98, "ASN"], [0x99, "ATN"], [0xc6, "AUTO"], [0x9a, "BGET", true],
  [0xd5, "BPUT", true], [0xfb, "COLOUR"], [0xfb, "COLOR"], [0xd6, "CALL"],
  [0xd7, "CHAIN"], [0xbd, "CHR$"], [0xd8, "CLEAR", true], [0xd9, "CLOSE", true],
  [0xda, "CLG", true], [0xdb, "CLS", true], [0x9b, "COS"], [0x9c, "COUNT", true],
  [0xdc, "DATA"], [0x9d, "DEG"], [0xdd, "DEF"], [0xc7, "DELETE"], [0x81, "DIV"],
  [0xde, "DIM"], [0xdf, "DRAW"], [0xe1, "ENDPROC", true], [0xe0, "END", true],
  [0xe2, "ENVELOPE"], [0x8b, "ELSE"], [0xa0, "EVAL"], [0x9e, "ERL", true],
  [0x85, "ERROR"], [0xc5, "EOF", true], [0x82, "EOR"], [0x9f, "ERR", true],
  [0xa1, "EXP"], [0xa2, "EXT", true], [0xe3, "FOR"], [0xa3, "FALSE", true],
  [0xa4, "FN"], [0xe5, "GOTO"], [0xbe, "GET$"], [0xa5, "GET"], [0xe4, "GOSUB"],
  [0xe6, "GCOL"], [0x93, "HIMEM", true], [0xe8, "INPUT"], [0xe7, "IF"],
  [0xbf, "INKEY$"], [0xa6, "INKEY"], [0xa8, "INT"], [0xa7, "INSTR("],
  [0xc9, "LIST"], [0x86, "LINE"], [0xc8, "LOAD"], [0x92, "LOMEM", true],
  [0xea, "LOCAL"], [0xc0, "LEFT$("], [0xa9, "LEN"], [0xe9, "LET"], [0xab, "LOG"],
  [0xaa, "LN"], [0xc1, "MID$("], [0xeb, "MODE"], [0x83, "MOD"], [0xec, "MOVE"],
  [0xed, "NEXT"], [0xca, "NEW", true], [0xac, "NOT"], [0xcb, "OLD", true],
  [0xee, "ON"], [0x87, "OFF"], [0x84, "OR"], [0x8e, "OPENIN"], [0xae, "OPENOUT"],
  [0xad, "OPENUP"], [0xff, "OSCLI"], [0xf1, "PRINT"], [0x90, "PAGE", true],
  [0x8f, "PTR", true], [0xaf, "PI", true], [0xf0, "PLOT"], [0xb0, "POINT("],
  [0xf2, "PROC"], [0xb1, "POS", true], [0xce, "PUT"], [0xf8, "RETURN", true],
  [0xf5, "REPEAT"], [0xf6, "REPORT", true], [0xf3, "READ"], [0xf4, "REM"],
  [0xf9, "RUN", true], [0xb2, "RAD"], [0xf7, "RESTORE"], [0xc2, "RIGHT$("],
  [0xb3, "RND", true], [0xcc, "RENUMBER"], [0x88, "STEP"], [0xcd, "SAVE"],
  [0xb4, "SGN"], [0xb5, "SIN"], [0xb6, "SQR"], [0x89, "SPC"], [0xc3, "STR$"],
  [0xc4, "STRING$("], [0xd4, "SOUND"], [0xfa, "STOP", true], [0xb7, "TAN"],
  [0x8c, "THEN"], [0xb8, "TO"], [0x8a, "TAB("], [0xfc, "TRACE"],
  [0x91, "TIME", true], [0xb9, "TRUE", true], [0xfd, "UNTIL"], [0xba, "USR"],
  [0xef, "VDU"], [0xbb, "VAL"], [0xbc, "VPOS", true], [0xfe, "WIDTH"],
  [0xd3, "HIMEM"], [0xd2, "LOMEM"], [0xd0, "PAGE"], [0xcf, "PTR"], [0xd1, "TIME"]
];

const lineNumberTokens = new Set([0xe5, 0xe4, 0xf7, 0xfc]);
const leftModeTokens = new Set([0x8c, 0x8b, 0xf5, 0x85, 0x3a]);
const pseudoVariableGetters = new Set([0x8f, 0x90, 0x91, 0x92, 0x93]);
const windows1252SpecialCodes = new Map([
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84], ["…", 0x85],
  ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88], ["‰", 0x89], ["Š", 0x8a],
  ["‹", 0x8b], ["Œ", 0x8c], ["Ž", 0x8e], ["‘", 0x91], ["’", 0x92],
  ["“", 0x93], ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97],
  ["˜", 0x98], ["™", 0x99], ["š", 0x9a], ["›", 0x9b], ["œ", 0x9c],
  ["ž", 0x9e], ["Ÿ", 0x9f]
]);
export function tokenizeAgonBasic(source) {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = new Map();

  for (const [sourceIndex, originalLine] of normalized.split("\n").entries()) {
    const sourceLine = sourceIndex + 1;
    const line = stripInputControls(originalLine);
    if (line.trim().length === 0) continue;
    const match = /^\s*(\d+)(.*)$/u.exec(line);
    if (!match) throw new Error(`Agon BASIC source line ${sourceLine} has no line number.`);
    const lineNumber = Number(match[1]);
    if (!Number.isInteger(lineNumber) || lineNumber < 0 || lineNumber > 0xfeff) {
      throw new Error(`Agon BASIC source line ${sourceLine} has invalid line number ${match[1]}.`);
    }
    const body = match[2].replace(/^ +/u, "");
    if (body.length === 0) {
      lines.delete(lineNumber);
      continue;
    }
    lines.set(lineNumber, { body, sourceLine });
  }

  const output = [];
  for (const [lineNumber, { body, sourceLine }] of [...lines].sort(([left], [right]) => left - right)) {
    const tokenized = tokenizeLine(body, sourceLine);
    if (tokenized.length > 251) {
      throw new Error(`Agon BASIC source line ${sourceLine} tokenizes to ${tokenized.length} bytes; the maximum is 251.`);
    }
    output.push(tokenized.length + 4, lineNumber & 0xff, lineNumber >>> 8, ...tokenized, CARRIAGE_RETURN);
  }
  output.push(0, 0xff, 0xff);
  return Buffer.from(output);
}

function tokenizeLine(source, sourceLine) {
  const output = [];
  let index = 0;
  let flags = 1;

  while (index < source.length) {
    const char = source[index];
    const rawByte = encodeWindows1252Character(char, sourceLine);

    if (!isRange1(char)) flags &= ~(0x20 | 0x08 | 0x04);
    if (rawByte < 0x32) flags &= ~0x04;
    if (rawByte >= 0x47) flags &= ~0x08;
    if (rawByte === 0x22) flags ^= 0x80;

    if ((flags & 0x10) !== 0) {
      flags &= ~0x10;
      while (source[index] === " ") index += 1;
      const start = index;
      while (index < source.length && source[index] >= "0" && source[index] <= "9") index += 1;
      if (index > start) {
        const lineNumber = Number(source.slice(start, index));
        if (lineNumber > 0xfeff) throw new Error(`Agon BASIC source line ${sourceLine} contains an oversized line reference.`);
        if (lineNumber !== 0) {
          output.push(...encodeLineNumber(lineNumber));
          flags |= 0x10;
        }
      }
      continue;
    }

    flags = (flags - 1) & 0xff;
    let leftMode = false;
    if (flags === 0) {
      leftMode = true;
    } else {
      flags = (flags + 1) & 0xff;
      if (flags !== 0) {
        output.push(rawByte);
        index += 1;
        continue;
      }
    }

    let value = rawByte;
    let consumed = 1;
    const starCommand = leftMode && rawByte === 0x2a;
    if (!starCommand && rawByte < 0x80) {
      const match = matchKeyword(source, index);
      if (match) {
        value = match.token;
        consumed = match.length;
      }
    }
    if (leftMode && pseudoVariableGetters.has(value)) value += 0x40;

    if (starCommand || value === 0xf4 || value === 0xdc) flags |= 0x40;
    if (value === 0xa4 || value === 0xf2 || (value < 0x80 && isRange2(String.fromCharCode(value)))) flags |= 0x20;
    if (value === 0x26) flags |= 0x08;
    if (value === 0x25) flags |= 0x04;
    if (lineNumberTokens.has(value)) flags |= 0x10;
    if (leftModeTokens.has(value)) flags |= 0x01;

    output.push(value);
    index += consumed;
  }
  return output;
}

function matchKeyword(source, index) {
  for (const [token, keyword, delimiterRequired = false] of keywords) {
    let matched = true;
    let position = index;
    for (let keywordIndex = 0; keywordIndex < keyword.length; keywordIndex += 1) {
      if (keywordIndex > 0 && source[position] === ".") {
        return { token, length: position - index + 1 };
      }
      if (source[position] !== keyword[keywordIndex]) {
        matched = false;
        break;
      }
      position += 1;
    }
    if (!matched) continue;
    if (delimiterRequired && isRange1(source[position] ?? "")) continue;
    return { token, length: position - index };
  }
  return undefined;
}

function encodeLineNumber(lineNumber) {
  const low = lineNumber & 0xff;
  const high = lineNumber >>> 8;
  const packedHighBits = (((low & 0xc0) >>> 2) | ((high & 0xc0) >>> 4)) ^ 0x54;
  return [LINE_NUMBER_TOKEN, packedHighBits, (low & 0x3f) | 0x40, (high & 0x3f) | 0x40];
}

function isRange1(char) {
  return (char >= "0" && char <= "9") || char === "@" || isRange2(char);
}

function isRange2(char) {
  return (char >= "A" && char <= "Z") || (char >= "_" && char <= "z");
}

function stripInputControls(line) {
  return [...line].filter((char) => (char.codePointAt(0) ?? 0) >= 0x20).join("");
}

function encodeWindows1252Character(char, sourceLine) {
  const code = char.codePointAt(0);
  if (code !== undefined && (code <= 0x7f || (code >= 0xa0 && code <= 0xff))) return code;
  const mapped = windows1252SpecialCodes.get(char);
  if (mapped !== undefined) return mapped;
  throw new Error(`Agon BASIC source line ${sourceLine} contains character ${JSON.stringify(char)} which Windows-1252 cannot encode.`);
}
