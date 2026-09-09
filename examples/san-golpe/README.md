# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`; the continuation prompt is a separate resource. Source files contain presentation and keyboard handling.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --font mixed --no-tools
```

English is the default. `--font mixed` enables the C64 uppercase/lowercase character set. German umlauts use portable `ae`/`oe`/`ue` spellings in generated BASIC. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.
