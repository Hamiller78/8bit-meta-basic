import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tokenizeAgonBasic } from "./lib/agon-basic-tokenizer.mjs";

export async function runTokenizeAgonBasicCli(argv = process.argv.slice(2)) {
  const paths = [];
  for (const argument of argv) {
    if (argument.startsWith("-")) throw new Error(`Unknown option "${argument}".`);
    else paths.push(argument);
  }
  if (paths.length !== 2) {
    throw new Error("Usage: node scripts/tokenize-agon-basic.mjs input.bas output.bbc");
  }
  const source = await readFile(paths[0], "utf8");
  await mkdir(dirname(resolve(paths[1])), { recursive: true });
  await writeFile(paths[1], tokenizeAgonBasic(source));
  console.log(`created ${paths[1]}`);
}

if (process.argv[1]?.endsWith("tokenize-agon-basic.mjs")) {
  runTokenizeAgonBasicCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
