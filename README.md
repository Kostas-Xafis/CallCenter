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
- The administrator exports the two source files (see `update/ΟΔΗΓΙΕΣ.pdf`):
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
a «Μη συνδέετε» tag. The Excel colouring that used to mark them is lost in the
CSV export, so they are kept in `update/ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt` (shipped next to
`update.cmd`): one number at the start of each line, anything after it and
`#` lines ignored. `update.ps1` refuses to run if the file is missing, so the
red marks can never disappear by accident; an empty file means "none". The
dev script reads the same file.

## Development

```bash
bun install
bun run build        # app/ + update/ → dist/ (committed; page has NO data)
bun run data:dev     # page with the real data from ./actual_data → preview/ (git-ignored)
bun run guide        # update/guide/ΟΔΗΓΙΕΣ.html → update/ΟΔΗΓΙΕΣ.pdf (needs Chrome)
bun test             # parsers, search, payload, and dist/ being up to date
```

- **`dist/` is committed** because administrators cannot run Bun/Node: they
  download the `static-catalog` branch ZIP from GitHub and copy it to their PC.
  Always run `bun run build` before committing; `tests/release.test.ts` fails
  if `dist/` is out of date or its page contains data.
- `dist/data/*` and `dist/backup/` are git-ignored, so nothing an administrator
  adds there can be committed by accident. `dist/**` is stored byte for byte
  (`-text`) so the Windows scripts keep their CRLF and BOM in the ZIP.
- `bun run data:dev [folder]` is the Linux/macOS equivalent of `update.ps1`.
  The real script can also be run here with PowerShell for Linux:
  `pwsh -File dist/update.ps1` (in a copy of dist/, not in the repo).

`actual_data/` and `preview/` hold personal data and are git-ignored.

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
  ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt     restricted («Μη συνδέετε») numbers, edited by the administrators
  ΟΔΗΓΙΕΣ.pdf           step-by-step guide for administrators (Greek); `bun run guide`
  guide/ΟΔΗΓΙΕΣ.html    source of the guide (print-styled HTML, rendered with headless Chrome)
  guide/header.png      screenshot used in the guide
scripts/
  build.ts, dev-data.ts, lib/payload.ts
tests/
```

## Release

1. `bun run build` (and `bun run guide` if the guide changed), `bun test`.
2. Commit and push to the **`static-catalog`** branch. Administrators download
   it as `https://github.com/kostas-xafis/callcenter/archive/refs/heads/static-catalog.zip`
   (the default branch, `main`, still holds the old server app).
3. Administrators follow «Εγκατάσταση και νέες εκδόσεις» in `ΟΔΗΓΙΕΣ.pdf`:
   first time, copy all of `dist/`; for a new version, replace only
   `katalogos.html`, `update.cmd`, `update.ps1`, `ΟΔΗΓΙΕΣ.pdf` (never their
   `ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt` or `data\`) and run `update.cmd`.
