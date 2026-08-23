#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const defaultIdleTimeoutMs = 5 * 60 * 1000;

async function run(options) {
  await mkdir(dirname(options.output), { recursive: true });
  const output = createWriteStream(options.output, { flags: "w" });
  let idleTimer;

  const server = createServer((socket) => {
    resetIdleTimer();
    socket.on("data", (chunk) => {
      output.write(chunk);
      resetIdleTimer();
    });
    socket.on("close", resetIdleTimer);
    socket.on("error", resetIdleTimer);
  });

  server.on("error", (error) => {
    output.end();
    throw error;
  });

  await new Promise((resolveListen) => {
    server.listen(options.port, options.host, resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("RS232 capture did not get a TCP address.");
  }

  if (options.ready) {
    await mkdir(dirname(options.ready), { recursive: true });
    await writeFile(options.ready, JSON.stringify({ host: options.host, port: address.port }), "utf8");
  }

  resetIdleTimer();

  function resetIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      server.close();
      output.end();
    }, options.idleTimeoutMs);
    idleTimer.unref();
  }
}

function parseArgs(argv) {
  const options = {
    output: undefined,
    host: defaultHost,
    port: defaultPort,
    ready: undefined,
    idleTimeoutMs: defaultIdleTimeoutMs
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      options.output = resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--host") {
      options.host = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.port = Number(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--ready") {
      options.ready = resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--idle-timeout-ms") {
      options.idleTimeoutMs = Number(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown option "${arg}".`);
  }

  if (!options.output) {
    throw new Error("Missing --output.");
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535.");
  }
  if (!Number.isInteger(options.idleTimeoutMs) || options.idleTimeoutMs < 1000) {
    throw new Error("--idle-timeout-ms must be at least 1000.");
  }
  return options;
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

async function main() {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
