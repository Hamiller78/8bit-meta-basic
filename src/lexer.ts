export function removeLineComment(line: string): string {
  let inString = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (char === "'" && !inString) {
      return line.slice(0, index);
    }
  }

  return line;
}
