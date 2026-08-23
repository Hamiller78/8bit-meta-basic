# MetaBASIC VS Code Extension

This is the first small Visual Studio Code shell around the existing MetaBASIC tools.

Implemented so far:

- Registers `*.mbas` files as the `metabasic` language.
- Adds basic TextMate syntax highlighting.
- Adds the command `MetaBASIC: Build Project`.
- Runs the existing repository script:

```text
npm run build:all-targets -- --project <workspace-folder> --profile <profile>
```

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

## Next Milestones

- Add commands for test runs and emulator launch.
- Add problem matchers or diagnostics for compiler errors.
- Add snippets for common MetaBASIC structures.
- Package the compiler tools with the extension instead of depending on a local checkout.
