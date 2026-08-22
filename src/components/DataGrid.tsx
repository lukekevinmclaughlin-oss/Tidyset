import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Column, Table } from '../engine/types'
import { ChangedMask, cellKey } from '../engine/pipeline'
import { completeness } from '../engine/dataframe'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

const ROW_H = 30
const HEAD_H = 50
const NUM_W = 56
const COL_W = 172
const MIN_W = 70
const MAX_W = 520

export function DataGrid({
  table,
  mask,
  order,
  selectedColumn,
  onSelectColumn,
  sortCol,
  sortDir,
  onSort,
  revision
}: {
  table: Table
  mask: ChangedMask | null
  order: number[]
  selectedColumn: string | null
  onSelectColumn: (name: string) => void
  sortCol: string | null
  sortDir: 'asc' | 'desc'
  onSort: (name: string) => void
  revision: string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const dragRef = useRef<{ id: string; startX: number; startW: number } | null>(null)

  const widthOf = (c: Column) => widths[c.id] ?? COL_W

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setViewportH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- column resize (drag borders) ----
  const onResizeMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    const w = Math.max(MIN_W, Math.min(MAX_W, d.startW + (e.clientX - d.startX)))
    setWidths((prev) => ({ ...prev, [d.id]: w }))
  }, [])
  const onResizeUp = useCallback(() => {
    dragRef.current = null
    document.body.style.cursor = ''
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', onResizeUp)
  }, [onResizeMove])
  const onResizeDown = useCallback(
    (e: React.MouseEvent, c: Column) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { id: c.id, startX: e.clientX, startW: widths[c.id] ?? COL_W }
      document.body.style.cursor = 'col-resize'
      window.addEventListener('mousemove', onResizeMove)
      window.addEventListener('mouseup', onResizeUp)
    },
    [onResizeMove, onResizeUp, widths]
  )
  useEffect(() => () => onResizeUp(), [onResizeUp])

  // double-click a resizer to auto-fit the column to its content
  const autoFit = useCallback((c: Column) => {
    let maxLen = c.name.length + 4
    const N = Math.min(c.values.length, 250)
    for (let i = 0; i < N; i++) {
      const v = c.values[i]
      if (v !== null && v !== undefined) maxLen = Math.max(maxLen, String(v).length)
    }
    const w = Math.min(MAX_W, Math.max(MIN_W, Math.round(maxLen * 7.3 + 28)))
    setWidths((prev) => ({ ...prev, [c.id]: w }))
  }, [])

  const nrows = order.length
  const overscan = 8
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - overscan)
  const visible = Math.ceil(viewportH / ROW_H) + overscan * 2
  const last = Math.min(nrows, first + visible)

  const rows: React.ReactNode[] = []
  for (let p = first; p < last; p++) {
    const i = order[p]
    const cells: React.ReactNode[] = [
      <div className="cell num" key="n" style={{ width: NUM_W }}>
        {i + 1}
      </div>
    ]
    for (const c of table.columns) {
      const v = c.values[i]
      const changed = mask?.cells.has(cellKey(c.name, i))
      const added = mask?.addedCols.has(c.name)
      const cls = ['cell']
      if (changed) cls.push('changed')
      else if (added) cls.push('added')
      if (c.name === selectedColumn) cls.push('selcol')
      if (v === null || v === undefined) cls.push('null')
      cells.push(
        <div className={cls.join(' ')} key={c.id} style={{ width: widthOf(c) }} title={v == null ? '' : String(v)}>
          {v === null || v === undefined ? '—' : String(v)}
        </div>
      )
    }
    rows.push(
      <div className={'row' + (p % 2 ? ' odd' : '')} key={p} style={{ top: p * ROW_H }}>
        {cells}
      </div>
    )
  }

  const totalW = NUM_W + table.columns.reduce((s, c) => s + widthOf(c), 0)

  return (
    <div
      className="grid-scroll"
      ref={scroller}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div className="grid-inner" style={{ width: totalW }}>
        <div className="grid-head" style={{ height: HEAD_H }}>
          <div className="hcell num" style={{ width: NUM_W }}>
            #
          </div>
          {table.columns.map((c) => {
            const added = mask?.addedCols.has(c.name)
            const fill = completeness(c.values)
            const isSorted = sortCol === c.name
            return (
              <div
                key={c.id}
                className={'hcell' + (selectedColumn === c.name ? ' sel' : '') + (added ? ' added' : '')}
                style={{ width: widthOf(c) }}
                onClick={() => onSelectColumn(c.name)}
              >
                <div className="hcell-top">
                  <span className="hname">{c.name}</span>
                  <span className={'badge ' + c.type}>{c.type.slice(0, 3)}</span>
                  <button
                    className={'sortbtn' + (isSorted ? ' on' : '')}
                    title="Sort"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSort(c.name)
                    }}
                  >
                    {isSorted ? (
                      sortDir === 'asc' ? (
                        <ChevronUp size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )
                    ) : (
                      <ChevronsUpDown size={12} />
                    )}
                  </button>
                </div>
                <div className="hbar" title={`${Math.round(fill * 100)}% filled`}>
                  <div
                    className={'hbar-fill' + (fill < 0.999 ? ' partial' : '')}
                    style={{ width: `${fill * 100}%` }}
                  />
                </div>
                <div
                  className="col-resizer"
                  title="Drag to resize · double-click to auto-fit"
                  onMouseDown={(e) => onResizeDown(e, c)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    autoFit(c)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )
          })}
        </div>
        <div className="grid-body" key={revision} style={{ height: Math.max(nrows * ROW_H, 1) }}>
          {rows}
        </div>
      </div>
      <style>{gridCss}</style>
    </div>
  )
}

const gridCss = `
.grid-scroll { flex: 1; overflow: auto; min-height: 0; }
.grid-inner { position: relative; min-width: 100%; }
.grid-head {
  position: sticky; top: 0; z-index: 5; display: flex;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 1px solid var(--hairline);
}
.hcell {
  position: relative;
  display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 0 12px;
  border-right: 1px solid var(--hairline); overflow: hidden;
  transition: background 0.14s;
}
.hcell:hover { background: var(--hover); }
.hcell:hover .sortbtn { opacity: 0.6; }
.hcell.sel { background: var(--active); box-shadow: inset 0 -2px 0 var(--accent); }
.hcell.added { background: var(--cell-added); }
.hcell-top { display: flex; align-items: center; gap: 7px; }
.hcell .hname { font-weight: 620; font-size: 12px; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.sortbtn {
  border: none; background: transparent; color: var(--text-3); cursor: default;
  padding: 2px; border-radius: 5px; display: grid; place-items: center; opacity: 0; transition: all 0.14s;
}
.sortbtn.on { opacity: 1; color: var(--accent); }
.sortbtn:hover { background: var(--hover); color: var(--accent); opacity: 1; }
.hbar { height: 3px; border-radius: 3px; background: var(--hairline); overflow: hidden; }
.hbar-fill { height: 100%; border-radius: 3px; background: var(--good); transition: width 0.3s ease; }
.hbar-fill.partial { background: linear-gradient(90deg, var(--warn), var(--good)); }
.col-resizer { position: absolute; top: 0; right: 0; width: 8px; height: 100%; cursor: col-resize; z-index: 4; }
.col-resizer:hover { background: linear-gradient(90deg, transparent, var(--accent-glow)); }
.hcell.num, .cell.num {
  position: sticky; left: 0; z-index: 2;
  justify-content: center; align-items: center; flex-direction: row; color: var(--text-3); font-weight: 550;
  background: var(--glass-bg-strong); font-size: 11px;
}
.hcell.num { z-index: 6; }
.grid-body { position: relative; }
.row { position: absolute; left: 0; display: flex; height: ${ROW_H}px; width: 100%; }
.row.odd .cell { background: rgba(130,146,171,0.045); }
.row:hover .cell { background: var(--hover); }
.cell {
  display: flex; align-items: center; padding: 0 12px; height: ${ROW_H}px;
  font-size: 12.5px; color: var(--text-1);
  border-right: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.1s;
}
.cell.selcol { background: rgba(47,124,246,0.05); }
.cell.null { color: var(--text-3); font-style: italic; }
.cell.changed { background: var(--cell-changed) !important; box-shadow: inset 2px 0 0 var(--accent); animation: cellpulse 0.5s ease; }
.cell.added { background: var(--cell-added) !important; animation: cellpulse 0.5s ease; }
@keyframes cellpulse {
  0% { background: var(--accent) !important; }
  100% {}
}
`
