# Τηλεφωνικός Κατάλογος

Phone directory for the call center of 251 ΓΝΑ. A small Tauri 2 desktop app
(Windows): one portable `.exe` placed in a shared network folder, run by every
call-center PC. Everyone can browse and search; an administrator (password)
can edit sections and phones and print the list.

## Layout

| folder | what |
| --- | --- |
| `app/` | the UI: plain HTML/CSS/ES modules, no bundler. `js/api.js` is the only code that talks to the backend (and has a browser mock). `assets/logo.png` is the source of the icons in `src-tauri/icons/` |
| `src-tauri/` | Rust backend: reads/writes `catalog.json`, password, backups |
| `docs/` | `CONTRACT.md`, the binding spec (data schema, backend commands, pages) |
| `guide/` | the customer guide in Greek (`ΟΔΗΓΙΕΣ.html` -> `ΟΔΗΓΙΕΣ.pdf`, `bun run guide`) |
| `tests/` | `bun test` for the search/data modules |

## Data

Next to the exe, in the shared folder: `catalog.json` (the data), `admin.json`
(password hash) and `backup/` (last 30 versions, one per save). Saves are
refused with a conflict if someone else saved first, and the view polls for
changes every 30 s. Details: [docs/CONTRACT.md](docs/CONTRACT.md).

Forgotten password: delete `admin.json`; the next «Διαχείριση» asks for a new one.

## Development

```sh
bun install
bun run tauri dev      # uses workspace/catalog.json, or the folder in CATALOG_DIR
```

To work without Tauri, serve `app/` statically (e.g. `python3 -m http.server`
inside `app/`) and open `index.html`. The mock in `api.js` loads
`app/dev-catalog.json` (copy it from `workspace/catalog.json`), keeps edits in
localStorage, and accepts the password `admin`. `workspace/`, `catalog.json`,
`admin.json` and `app/dev-catalog.json` hold real staff data and are git-ignored.

## Tests

```sh
bun test
cd src-tauri && cargo test
```

## Release

1. Run the GitHub Actions workflow **Windows build** (it also runs the Rust tests).
2. Download the `katalogos-windows` artifact (`Τηλεφωνικός Κατάλογος.exe`).
3. Put the exe, `catalog.json` and `guide/ΟΔΗΓΙΕΣ.pdf` in the customer's shared folder.
   Do not overwrite an existing `catalog.json` or `admin.json` when updating.
