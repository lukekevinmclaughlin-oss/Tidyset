# Tidyset

**The private, fully-offline data janitor.** Clean, fix and reshape messy spreadsheets, with every change reviewable and reproducible. No cloud. No AI. No surprises.

Tidyset is a desktop app (Electron + React + TypeScript) that does the deterministic work of a data engineer's clean-up pass: standardise inconsistent values, fix broken dates and phone numbers, fill gaps, split/merge columns, cluster near-duplicates, de-duplicate records, and run custom formulas. Everything runs locally with classic algorithms, so the same input always produces the same output, and nothing ever leaves the machine.

## Why it's different
- **100% offline & deterministic.** No network calls, no API keys, no model that could ever mangle a value unpredictably. Reproducible byte-for-byte.
- **Non-destructive by design.** The source table is never mutated. Every action is a reversible step in a pipeline.
- **Reusable recipes.** The undo pipeline *is* the recipe. Save it (`.tidyset`) and re-run it on next month's file. Clean once, reuse forever.
- **Reviewable changes.** Select any step to see the data as of that point with changed cells highlighted.

## Feature set
- **Import:** CSV, TSV, Excel (`.xlsx`), JSON, with encoding/delimiter detection and per-column type inference.
- **Smart Suggestions:** a deterministic scan proposes one-click fixes (trim, empty rows/columns, duplicates, mixed date formats, inconsistent capitalisation) with a **Fix all** action. Rule-based, never AI, and it re-computes as you clean.
- **Data-quality dashboard:** an overall **health score** ring (completeness − penalties), duplicate-row count, and a per-column issue breakdown (blanks, stray spaces, inconsistent values, type mismatch).
- **Column profiling:** click any column for a profile — filled/blank/distinct counts, and for numbers a **distribution histogram** plus min/max/mean/median/sum/std; text length stats; date range.
- **Column tools:** trim (Excel-style, collapses internal runs too), case, standardise dates → ISO, normalise phones, find & replace (literal or regex), split, extract (regex), fill missing (down/up/constant/mean/median/mode), change type, rename, filter rows, **move left/right**, delete. Actions can target one column or **all text columns** at once.
- **Cluster & merge:** fingerprint, n-gram, and nearest-neighbour (Jaro-Winkler) clustering to fix typos/variants, with an editable canonical value per cluster.
- **Dataset tools:** remove empty rows/columns, remove exact duplicates, merge columns, and **fuzzy de-duplicate** with survivorship rules (first / longest / most complete).
- **Formula language:** a safe, deterministic expression engine (`upper`, `concat`, `part`, `if`, `coalesce`, `round`, `regexReplace`, …) with live preview.
- **Grid:** virtualised for large files, view-only **sort** per column, global **search**, **resizable columns** (drag borders · double-click to auto-fit), per-column **completeness bars**, zebra striping, selected-column tint, and a **change pulse** on updated cells.
- **Dataset tools:** global **find & replace across all columns**, and **export the current view** (filtered + sorted) as an option.
- **Undo / redo** with full history, plus keyboard shortcuts (⌘O open · ⌘S save recipe · ⌘E export · ⌘Z / ⌘⇧Z undo/redo · ⌘F search · Esc deselect).
- **Recipe panel:** per-step **delta badges** (cells changed, ± rows/columns), reorder/toggle/remove, and select-a-step to see that snapshot with its changes highlighted.
- **Export:** CSV, Excel, JSON. Save/Load recipes. Non-blocking **toast** feedback throughout.
- **UI:** liquid-glass design, animated ambient background, framer-motion transitions, light + dark themes.

## Architecture
```
electron/            Electron main + preload (native file dialogs, local file IO only)
src/engine/          Pure, deterministic, fully-tested engine (no UI, no IO side effects)
  types.ts           Table / Column / Op / Recipe model
  dataframe.ts       Columnar store, type inference, date normalisation
  algorithms.ts      Levenshtein, Jaro-Winkler, fingerprint, clustering
  transforms.ts      Every cleaning operation (Op -> Table -> Table)
  pipeline.ts        Pipeline executor, diff mask, faceting, stats
  expression.ts      Recursive-descent expression parser + evaluator
  fill.ts, parsers.ts, io.ts, sample.ts
src/components/       React UI (DataGrid, Pipeline, Inspector + tools, Welcome)
src/state/store.ts   Zustand store (source table + ops + selection)
```
The engine is decoupled from the UI: transforms are pure functions, so the whole thing is unit-tested and could later be reused in a CLI or a web build.

## Develop
```bash
npm install
npm run dev        # launches Electron with hot reload
npm run typecheck  # tsc for main + renderer
npm test           # vitest — engine unit tests
npm run build      # bundle main/preload/renderer to out/
```

## Package a macOS DMG
```bash
npm run build:mac
```
> **Note on this folder path:** the parent directory name contains `::` (`DMG::Applications`). `electron-builder` / code-signing can choke on unusual characters in the build path. If DMG packaging fails, copy the project to a plain path (e.g. `~/Tidyset`), run `npm run build:mac` there, then move the DMG back.

## Distribution model (per the spec)
- **Free tier:** manual cleaning + core transforms + CSV.
- **Pro (one-time):** unlimited rows, cluster/fuzzy-dedupe/parsers/formulas, save/reuse recipes, batch, Excel export.
- **Channels:** Mac App Store (sandboxed, *no network entitlement* — a real marketing line) plus direct download, plus Windows from the same Electron codebase.

## Status
Core engine complete and unit-tested (23 tests green). Renderer verified end-to-end (import → suggestions/Fix-all → cluster → merge → sort → search → resize → profile/quality → undo/redo → diff highlight → recipe) in both light and dark themes. Not yet code-signed or packaged to DMG.
