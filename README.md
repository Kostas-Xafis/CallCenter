# 251 ΓΝΑ · Τηλεφωνικός Κατάλογος

A single, self-contained HTML page for the hospital call center: search the
telephone directory and the DECT handset inventory, with no server, no
network and no installation. Users open `katalogos.html` with a double click.

```
            development (this repo, Bun)                       administrator (Windows)
 app/  ──►  bun run build  ──►  dist/katalogos.html  ──copy──►  update.cmd  ──►  katalogos.html
                                dist/update.cmd, update.ps1         ▲            (data block rewritten)
                                                                    │
                                          data\DECT ΑΠΟΓΡΑΦΗ.csv      (Excel → Save as → CSV)
                                          data\THL_KATALOGOS_251_GNA.txt (Word → Save as → Plain text)
```

## How it works

- `katalogos.html` contains the whole app (HTML, CSS, JS, icon) **and** the
  data, inside a block delimited by `<!--CATALOG-DATA-BEGIN-->` /
  `<!--CATALOG-DATA-END-->`.
- The administrator exports the two source files (see `update/ΟΔΗΓΙΕΣ.txt`):
  the DECT spreadsheet's first sheet as **.csv** and the directory document as
  **.txt**, into `data\`.
- `update.ps1` (run through `update.cmd`, Windows PowerShell 5.1+) embeds the
  two files **byte for byte** (base64) in the data block. It does no parsing
  and needs nothing beyond stock Windows.
- The page does everything else when it opens (`app/js`):
  - `decode.js` — encoding detection: UTF-8 (± BOM), UTF-16, Windows-1253;
  - `parse-csv.js` — RFC 4180 CSV, separator detected (`,` `;` or tab);
  - `parse-dect.js`, `parse-directory.js` — the actual data model.

Payload (schema 2):

```js
{ schema: 2, generatedAt, generator,
  dect:      { file, modified, base64 },   // the .csv
  directory: { file, modified, base64 },   // the .txt
  restricted: ["3995", …] }
```

The DECT export is used exactly as maintained: columns are found by their
header text (`ΑΡΙΘΜΟΣ`, `ΟΝΟΜΑΤΕΠΩΝΥΜΟ`, `ΔΙΕΥΘΥΝΣΗ`, `ΘΕΣΗ`, `ΕΠΙΣΤΑΣΙΑ`),
unassigned numbers are skipped and `*`-prefixed names are shown as
shared/duty handsets. Full directorate names come from the directory
headings ("Διεύθυνση Τομέα Εργαστηρίων (ΔΤΕ)").

The directory text is preprocessed into this schema (see
`app/js/parse-directory.js` for all the rules and edge cases):

```js
Section { id, name, abbr, parent, heading }
// "ΔΥΠ / Σμήνος Μεταφορικών Μέσων (ΣΜΜ)" → { name: "Σμήνος Μεταφορικών Μέσων", abbr: "ΣΜΜ", parent: "ΔΥΠ" }

Entry { id, sectionId, path[], label, extensions[], ranges[], external[], raw, line }
// "Βιοπαθολογία. Αιμοδοσία\t4332,4384\t\t210-7786449"
//   → { path: ["Βιοπαθολογία"], label: "Αιμοδοσία", extensions: ["4332","4384"], external: ["210-7786449"] }
```

Problems (unrecognized lines, missing columns, duplicate numbers, a file that
looks like it was saved with the wrong encoding) appear as a
«⚠ προειδοποιήσεις» link under the «Τελευταία ενημέρωση» date (only when
there are any), so the administrator can fix the source.

### Restricted numbers

Numbers that calls must never be transferred to are shown with a red tint and
a «Μη συνδέετε» tag. The list currently lives in `$RestrictedNumbers` at the
top of `update/update.ps1` and is written into the data block (the dev script
reads the same list). It will be derived from the DECT spreadsheet once the
final file format is known.

## Development

```bash
bun install
bun run dev          # build dist/katalogos.html and load ./actual_data into it
bun test             # parser, search and payload tests
```

- `bun run build` — bundles `app/` into `dist/katalogos.html` (keeps any data
  already in it) and copies `update/*` next to it.
- `bun run data:dev [folder]` — Linux/macOS equivalent of `update.ps1`
  (embeds the newest .csv and .txt of the folder). The real script can also be
  run here with PowerShell for Linux: `pwsh -File dist/update.ps1`.

`actual_data/` holds personal data and is git-ignored.

### Layout

```
app/
  index.html            page template (placeholders for CSS/JS + empty data block)
  styles.css
  assets/
    icon.svg            browser-tab icon (inlined by the build)
    logo-128.png        header logo (inlined by the build; trimmed/downscaled from logo.png)
    logo.png            original 1024×1024 logo (source only, not embedded)
  js/
    main.js             UI: search box, source tabs, directorate filter, results
    data.js             payload → unified records for both sources
    decode.js           embedded bytes → text (encoding detection)
    parse-csv.js        CSV → rows (separator detection)
    parse-directory.js  telephone directory text → sections/entries
    parse-dect.js       DECT rows → handset records
    search.js           word-based, accent-insensitive search + highlighting
    normalize.js        text folding helpers
    greek-layout.js     Latin-keyboard → Greek conversion
    theme.js            light/dark theme
update/
  update.ps1            Windows data updater (PowerShell 5.1+, UTF-8 BOM)
  update.cmd            double-click wrapper
  ΟΔΗΓΙΕΣ.txt           instructions for administrators (Greek): how to export and update
scripts/
  build.ts, dev-data.ts, lib/payload.ts
tests/
```

## Release

Give the administrators the contents of `dist/` (`katalogos.html`,
`update.cmd`, `update.ps1`, `ΟΔΗΓΙΕΣ.txt`, empty `data/`). After that they
only re-export the .csv/.txt into `data\` and run `update.cmd`; a new build is needed
only when the app itself changes (the data block is preserved by
`bun run build`, but on their side they would replace `katalogos.html` and
re-run `update.cmd`).
