const path = require("node:path");
const vscode = require("vscode");

function createMetaBasicDiagnostics(output) {
  const collection = vscode.languages.createDiagnosticCollection("metabasic");

  return {
    collection,
    clearWorkspace(workspaceFolder) {
      clearWorkspaceDiagnostics(collection, workspaceFolder);
    },
    updateFromTranscript(workspaceFolder, transcript) {
      return updateDiagnosticsFromTranscript(collection, output, workspaceFolder, transcript);
    }
  };
}

function clearWorkspaceDiagnostics(collection, workspaceFolder) {
  const root = normalizePath(workspaceFolder.uri.fsPath);
  const urisToDelete = [];
  collection.forEach((uri) => {
    if (normalizePath(uri.fsPath).startsWith(root)) {
      urisToDelete.push(uri);
    }
  });
  for (const uri of urisToDelete) {
    collection.delete(uri);
  }
}

function updateDiagnosticsFromTranscript(collection, output, workspaceFolder, transcript) {
  const grouped = new Map();
  for (const line of transcript.split(/\r?\n/)) {
    const parsed = parseDiagnosticLine(line, workspaceFolder.uri.fsPath);
    if (!parsed) {
      continue;
    }
    const items = grouped.get(parsed.uri.toString()) ?? { uri: parsed.uri, diagnostics: [] };
    items.diagnostics.push(parsed.diagnostic);
    grouped.set(parsed.uri.toString(), items);
  }

  for (const { uri, diagnostics } of grouped.values()) {
    collection.set(uri, diagnostics);
  }

  const count = [...grouped.values()].reduce((sum, item) => sum + item.diagnostics.length, 0);
  if (count === 0) {
    output.appendLine("");
    output.appendLine("No MetaBASIC source diagnostics were recognized in the command output.");
  }
  return count;
}

function parseDiagnosticLine(line, projectPath) {
  const cleaned = stripAnsi(line).trim();
  const match = /^(.+?\.mbas):(\d+)(?::(\d+))?:\s+(.+)$/i.exec(cleaned);
  if (!match) {
    return undefined;
  }

  const filename = match[1];
  const lineNumber = Math.max(0, Number(match[2]) - 1);
  const columnNumber = match[3] ? Math.max(0, Number(match[3]) - 1) : 0;
  const uri = vscode.Uri.file(path.isAbsolute(filename) ? filename : path.resolve(projectPath, filename));
  const range = new vscode.Range(lineNumber, columnNumber, lineNumber, columnNumber + 1);
  const diagnostic = new vscode.Diagnostic(range, match[4], vscode.DiagnosticSeverity.Error);
  diagnostic.source = "MetaBASIC";
  return { uri, diagnostic };
}

function normalizePath(value) {
  return path.resolve(value).toLowerCase();
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

module.exports = {
  createMetaBasicDiagnostics
};
