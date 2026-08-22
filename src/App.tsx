import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './state/store'
import { foldAll, computeChangedMask, computeView, stepDelta, datasetStats, subsetRows } from './engine/pipeline'
import { parseData, toCSV, toJSON, toXLSX } from './engine/io'
import { sampleTable } from './engine/sample'
import { Recipe } from './engine/types'
import { Welcome } from './components/Welcome'
import { DataGrid } from './components/DataGrid'
import { Pipeline } from './components/Pipeline'
import { Inspector } from './components/Inspector'
import { Suggestions } from './components/Suggestions'
import { Toasts } from './components/Toasts'
import { Button } from './components/ui'
import {
  WandSparkles,
  FolderOpen,
  Download,
  Save,
  Upload,
  Trash2,
  Sun,
  Moon,
  ChevronDown,
  Table2,
  Undo2,
  Redo2,
  Search,
  X,
  ShieldCheck,
  Repeat
} from 'lucide-react'

export function App() {
  const [access, setAccess] = useState<AccessState | null>(null)
  const source = useStore((s) => s.source)
  const fileName = useStore((s) => s.fileName)
  const ops = useStore((s) => s.ops)
  const past = useStore((s) => s.past)
  const future = useStore((s) => s.future)
  const selectedOpId = useStore((s) => s.selectedOpId)
  const selectedColumn = useStore((s) => s.selectedColumn)
  const theme = useStore((s) => s.theme)
  const search = useStore((s) => s.search)
  const sortCol = useStore((s) => s.sortCol)
  const sortDir = useStore((s) => s.sortDir)
  const loadTable = useStore((s) => s.loadTable)
  const setOps = useStore((s) => s.setOps)
  const clearAll = useStore((s) => s.clearAll)
  const setTheme = useStore((s) => s.setTheme)
  const selectColumn = useStore((s) => s.selectColumn)
  const selectOp = useStore((s) => s.selectOp)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const cycleSort = useStore((s) => s.cycleSort)
  const setSearch = useStore((s) => s.setSearch)
  const notify = useStore((s) => s.notify)

  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<'recipe' | 'export' | null>(null)
  const [exportViewOnly, setExportViewOnly] = useState(false)
  const recipeInput = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.tidyset?.getTheme().then((t) => setTheme(t)).catch(() => {})
  }, [setTheme])

  useEffect(() => {
    window.tidyset?.getAccess().then(setAccess).catch(() => {
      setAccess({ hasAccess: true, isPurchased: false, isTrialActive: false, daysRemaining: 0, price: '€29,99', monthlyPrice: '€4,99', yearlyPrice: '€29,99' })
    })
    return window.tidyset?.onAccessChanged?.(setAccess)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      loadTable('customer-import-messy.csv', sampleTable())
    }
  }, [loadTable])

  // One fold produces every snapshot: powers grid, diff, deltas.
  const snapshots = useMemo(() => (source ? foldAll(source, ops) : []), [source, ops])
  const result = snapshots.length ? snapshots[snapshots.length - 1] : null
  const selIdx = selectedOpId ? ops.findIndex((o) => o.id === selectedOpId) : -1

  const display = selIdx >= 0 ? snapshots[selIdx + 1] : result
  const mask = selIdx >= 0 ? computeChangedMask(snapshots[selIdx], snapshots[selIdx + 1]) : null
  const deltas = useMemo(
    () => ops.map((_, i) => (snapshots[i] && snapshots[i + 1] ? stepDelta(snapshots[i], snapshots[i + 1]) : null)),
    [snapshots, ops]
  )
  const order = useMemo(
    () => (display ? computeView(display, search, sortCol, sortDir) : []),
    [display, search, sortCol, sortDir]
  )
  const stats = useMemo(() => (display ? datasetStats(display) : null), [display])

  function handleBytes(name: string, bytes: ArrayBuffer, text?: string) {
    try {
      const table = parseData(name, bytes, text)
      loadTable(name, table)
      notify(`Loaded ${name} · ${table.nrows.toLocaleString()} rows`, 'success')
    } catch (e) {
      notify('Could not read file: ' + (e as Error).message, 'error')
    }
  }

  async function openDialog() {
    const f = await window.tidyset?.openFile()
    if (f) handleBytes(f.name, f.bytes)
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    if (file.name.endsWith('.tidyset')) loadRecipeText(new TextDecoder().decode(buf))
    else handleBytes(file.name, buf)
  }

  function loadRecipeText(text: string) {
    try {
      const r = JSON.parse(text) as Recipe
      if (r.app !== 'tidyset' || !Array.isArray(r.ops)) throw new Error('Not a Tidyset recipe')
      setOps(r.ops)
      notify(`Recipe loaded · ${r.ops.length} steps`, 'success')
    } catch (e) {
      notify('Invalid recipe: ' + (e as Error).message, 'error')
    }
  }

  const baseName = fileName.replace(/\.[^.]+$/, '') || 'tidyset'

  async function saveRecipe() {
    setMenu(null)
    const recipe: Recipe = { app: 'tidyset', version: 1, name: baseName, createdAt: new Date().toISOString(), ops }
    const path = await window.tidyset?.saveFile(`${baseName}.tidyset`, JSON.stringify(recipe, null, 2))
    if (path) notify(`Recipe saved · ${ops.length} steps`, 'success')
  }

  async function exportAs(fmt: 'csv' | 'json' | 'xlsx') {
    setMenu(null)
    if (!result) return
    const out = exportViewOnly && display ? subsetRows(display, order) : result
    let path: string | null | undefined
    if (fmt === 'csv') path = await window.tidyset?.saveFile(`${baseName}-clean.csv`, toCSV(out))
    else if (fmt === 'json') path = await window.tidyset?.saveFile(`${baseName}-clean.json`, toJSON(out))
    else path = await window.tidyset?.saveFile(`${baseName}-clean.xlsx`, toXLSX(out))
    if (path)
      notify(
        `Exported ${out.nrows.toLocaleString()} rows to ${fmt.toUpperCase()}${exportViewOnly ? ' (current view)' : ''}`,
        'success'
      )
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) {
        if (e.key === 'Escape') {
          selectOp(null)
          setMenu(null)
        }
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (k === 'o') {
        e.preventDefault()
        openDialog()
      } else if (k === 's' && source) {
        e.preventDefault()
        saveRecipe()
      } else if (k === 'e' && source) {
        e.preventDefault()
        exportAs('csv')
      } else if (k === 'f' && source) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, ops, result, fileName])

  return (
    <div
      className="shell"
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
      onClick={() => menu && setMenu(null)}
    >
      <div className="ambient">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
      </div>

      <div className="titlebar">
        <div className="brand">
          <span className="logo">
            <WandSparkles size={13} />
          </span>
          Tidyset
        </div>
        {source && (
          <div className="file">
            <span className="dot">•</span>
            {fileName}
            {stats && (
              <>
                <span className="dot">•</span>
                {stats.rows.toLocaleString()} rows × {stats.cols} cols
              </>
            )}
          </div>
        )}
        <div className="spacer" />
        <div className="actions">
          <Button className="ghost-icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </div>
      </div>

      {source && (
        <div className="toolbar">
          <div className="tgroup">
            <Button onClick={openDialog} title="Open (⌘O)">
              <FolderOpen size={14} /> Open
            </Button>
          </div>

          <div className="tgroup">
            <Button onClick={undo} disabled={!past.length} title="Undo (⌘Z)" className="ghost-icon">
              <Undo2 size={15} />
            </Button>
            <Button onClick={redo} disabled={!future.length} title="Redo (⌘⇧Z)" className="ghost-icon">
              <Redo2 size={15} />
            </Button>
          </div>

          <div className="tgroup" style={{ position: 'relative' }}>
            <Button
              onClick={(e) => {
                e.stopPropagation()
                setMenu(menu === 'recipe' ? null : 'recipe')
              }}
              active={menu === 'recipe'}
            >
              <Save size={14} /> Recipe <ChevronDown size={12} />
            </Button>
            {menu === 'recipe' && (
              <div className="menu glass" onClick={(e) => e.stopPropagation()}>
                <button onClick={saveRecipe}>
                  <Save size={14} /> Save recipe (.tidyset) <kbd>⌘S</kbd>
                </button>
                <button onClick={() => recipeInput.current?.click()}>
                  <Upload size={14} /> Load recipe…
                </button>
              </div>
            )}
          </div>

          <div className="tgroup" style={{ position: 'relative' }}>
            <Button
              onClick={(e) => {
                e.stopPropagation()
                setMenu(menu === 'export' ? null : 'export')
              }}
              active={menu === 'export'}
            >
              <Download size={14} /> Export <ChevronDown size={12} />
            </Button>
            {menu === 'export' && (
              <div className="menu glass" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => exportAs('csv')}>
                  Export CSV <kbd>⌘E</kbd>
                </button>
                <button onClick={() => exportAs('xlsx')}>Export Excel (.xlsx)</button>
                <button onClick={() => exportAs('json')}>Export JSON</button>
                <label className="menu-toggle" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={exportViewOnly}
                    onChange={(e) => setExportViewOnly(e.target.checked)}
                  />
                  Current view only (filter &amp; sort)
                </label>
              </div>
            )}
          </div>

          <div className="spacer" style={{ flex: 1 }} />

          {selectedOpId && (
            <div className="snapshot-pill">
              <Table2 size={13} /> Viewing step {selIdx + 1} — highlighting its changes
            </div>
          )}

          <div className="tgroup">
            <Button onClick={clearAll} title="Close file">
              <Trash2 size={14} /> Close
            </Button>
          </div>
        </div>
      )}

      <input
        ref={recipeInput}
        type="file"
        accept=".tidyset,.json"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) loadRecipeText(await f.text())
          e.target.value = ''
        }}
      />

      {!source ? (
        <Welcome onOpen={openDialog} onSample={() => loadTable('sample-messy.csv', sampleTable())} />
      ) : (
        <>
          {display && (
            <div className="suggest-slot">
              <Suggestions table={result!} />
            </div>
          )}
          <div className="body">
            <Pipeline deltas={deltas} />
            <div className="pane center glass">
              <div className="center-head">
                <div className="search">
                  <Search size={14} />
                  <input
                    ref={searchRef}
                    placeholder="Search all columns…  (⌘F)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="search-x" onClick={() => setSearch('')}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="rowcount">
                  {order.length === display!.nrows
                    ? `${display!.nrows.toLocaleString()} rows`
                    : `${order.length.toLocaleString()} of ${display!.nrows.toLocaleString()} rows`}
                </div>
              </div>
              {display && (
                <DataGrid
                  table={display}
                  mask={mask}
                  order={order}
                  selectedColumn={selectedColumn}
                  onSelectColumn={selectColumn}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={cycleSort}
                  revision={`${selectedOpId ?? 'r'}:${ops.length}`}
                />
              )}
            </div>
            {display && <Inspector table={display} />}
          </div>
        </>
      )}

      {dragging && (
        <div className="dropzone">
          <div className="dropzone-inner glass">
            <FolderOpen size={40} />
            <p>Drop to open</p>
            <span>CSV · TSV · Excel · JSON · .tidyset recipe</span>
          </div>
        </div>
      )}

      <Toasts />
      <style>{css}</style>
    </div>
  )
}

const css = `
.paywall-legal { display: flex; justify-content: center; gap: 16px; }
.paywall-legal button { border: 0; background: none; color: var(--accent); font: inherit; font-size: 11px; text-decoration: underline; cursor: pointer; }
.menu {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
  border-radius: 13px; padding: 6px; min-width: 210px; display: flex; flex-direction: column; gap: 2px;
}
.menu button {
  display: flex; align-items: center; gap: 9px; border: none; background: transparent;
  font-family: inherit; font-size: 12.5px; font-weight: 520; color: var(--text-1);
  padding: 8px 10px; border-radius: 9px; cursor: default; text-align: left;
}
.menu button kbd { margin-left: auto; }
.menu button:hover { background: var(--hover); }
.menu-toggle { display: flex; align-items: center; gap: 7px; padding: 8px 10px; margin-top: 4px; border-top: 1px solid var(--hairline); font-size: 11.5px; color: var(--text-2); cursor: default; }
.menu-toggle input { accent-color: var(--accent); }
.snapshot-pill {
  display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 560;
  color: var(--accent); background: var(--active); padding: 6px 11px; border-radius: 9px; margin-right: 8px;
}
.suggest-slot { padding: 0 12px; }
.center-head {
  display: flex; align-items: center; gap: 12px; padding: 9px 12px;
  border-bottom: 1px solid var(--hairline);
}
.search {
  display: flex; align-items: center; gap: 7px; flex: 1; max-width: 420px;
  background: var(--glass-bg-strong); border: 1px solid var(--glass-brd-2);
  border-radius: 10px; padding: 6px 10px; color: var(--text-3);
}
.search input {
  border: none; background: transparent; outline: none; flex: 1;
  font-family: inherit; font-size: 12.5px; color: var(--text-1);
}
.search-x { border: none; background: transparent; color: var(--text-3); cursor: default; padding: 2px; border-radius: 5px; display: grid; place-items: center; }
.search-x:hover { background: var(--hover); color: var(--text-1); }
.rowcount { margin-left: auto; font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; font-weight: 500; }
.dropzone {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
  background: rgba(20,33,58,0.28); backdrop-filter: blur(6px); animation: fade 0.15s ease;
}
.dropzone-inner {
  border-radius: 24px; padding: 46px 64px; text-align: center; color: var(--accent);
  border: 2px dashed var(--accent) !important;
}
.dropzone-inner p { font-size: 18px; font-weight: 680; color: var(--text-1); margin-top: 12px; }
.dropzone-inner span { font-size: 12px; color: var(--text-3); }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
`
