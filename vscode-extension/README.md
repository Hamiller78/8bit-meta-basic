# MetaBASIC VS Code Extension

This is the first small Visual Studio Code shell around the existing MetaBASIC tools.

Implemented so far:

- Registers `*.mbas` files as the `metabasic` language.
- Adds basic TextMate syntax highlighting.
- Adds commands that call the existing build and launch scripts through a dedicated `MetaBASIC` output channel.
- Turns compiler errors in `file:line:column: message` format into VS Code Problems diagnostics.

Current commands:

- `MetaBASIC: Build Project`
- `MetaBASIC: Build Target...`
- `MetaBASIC: Deploy Project`
- `MetaBASIC: Deploy Target...`
- `MetaBASIC: Build Tests`
- `MetaBASIC: Launch Project`
- `MetaBASIC: Launch Target...`
- `MetaBASIC: Launch Tests`

For example, `MetaBASIC: Build Project` runs a compiler-only build:

```text
npm run build:all-targets -- --project <workspace-folder> --profile <profile> --out-dir <workspace-folder>/build --no-tools
```

`MetaBASIC: Deploy Project` runs the same build without `--no-tools`, so configured tools such as `bas2tap`, `petcat`, or the Atari tokenizer can create emulator/device artifacts.

Build artifacts are written below the open project folder, for example:

```text
<workspace-folder>/build/debug/spectrum/<project-name>.bas
```

`MetaBASIC: Launch Tests` runs the equivalent launch script with `--run-tests`, and can optionally mirror test output to the configured printer or RS-232 device.

When a build command fails because of a MetaBASIC source error, the extension parses compiler output and adds entries to VS Code's Problems panel. Selecting a problem jumps to the reported `.mbas` source location.

## Try It During Development

1. Open this repository in VS Code.
2. Open the `vscode-extension` folder as the extension development folder, or use VS Code's extension host launch flow from this folder.
3. In the Extension Development Host, open a conventional MetaBASIC project folder with:

```text
source/
tests/
```

4. Run `MetaBASIC: Build Project` from the command palette.

By default the extension assumes it is being developed inside this repository and uses the parent folder as the MetaBASIC tool checkout. If you run it from elsewhere, set:

```json
{
  "metabasic.toolRoot": "C:/Users/Knees/source/repos/8bit-meta-basic"
}
```

## Settings

- `metabasic.toolRoot`: path to the MetaBASIC tool checkout.
- `metabasic.profile`: `debug`, `balanced`, or `release`.
- `metabasic.runExternalTools`: whether configured converter tools should run during builds.
- `metabasic.restartEmulators`: whether launch commands pass `--restart`.
- `metabasic.mirrorTestOutput`: whether launch test commands pass `--printer-output`.
- `metabasic.testOutputDevice`: `printer`, `text-printer`, or `rs232` when mirrored test output is enabled.

## Next Milestones

- Add snippets for common MetaBASIC structures.
- Package the compiler tools with the extension instead of depending on a local checkout.
