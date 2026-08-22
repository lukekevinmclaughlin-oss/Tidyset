import { CellValue, Column, Op, Table, cloneTable, uid } from './types'
import { coerce, isBlank, normalizeDate } from './dataframe'
import { computeFill, FillStrategy } from './fill'
import { applyParse } from './parsers'
import { jaroWinkler } from './algorithms'
import { compileExpression } from './expression'

// ---- helpers ----------------------------------------------------------------

function pickColumns(t: Table, names: string[]): Column[] {
  const set = new Set(names)
  return t.columns.filter((c) => set.has(c.name))
}

function mapColumn(col: Column, fn: (v: CellValue) => CellValue): void {
  for (let i = 0; i < col.values.length; i++) col.values[i] = fn(col.values[i])
}

function keepRows(t: Table, keep: (i: number) => boolean): Table {
  const idx: number[] = []
  for (let i = 0; i < t.nrows; i++) if (keep(i)) idx.push(i)
  return {
    nrows: idx.length,
    columns: t.columns.map((c) => ({ ...c, values: idx.map((i) => c.values[i]) }))
  }
}

const S = (v: CellValue) => (v === null || v === undefined ? '' : String(v))

// ---- transform registry -----------------------------------------------------

type Handler = (t: Table, p: Record<string, any>) => Table

const HANDLERS: Record<string, Handler> = {
  trim(t, p) {
    // Excel-style TRIM: strip leading/trailing and collapse internal whitespace runs.
    const out = cloneTable(t)
    for (const c of pickColumns(out, p.columns))
      mapColumn(c, (v) => (isBlank(v) ? v : S(v).trim().replace(/\s+/g, ' ')))
    return out
  },

  changeCase(t, p) {
    const out = cloneTable(t)
    const fn =
      p.mode === 'upper'
        ? (s: string) => s.toUpperCase()
        : p.mode === 'lower'
          ? (s: string) => s.toLowerCase()
          : (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    for (const c of pickColumns(out, p.columns)) mapColumn(c, (v) => (isBlank(v) ? v : fn(S(v))))
    return out
  },

  replace(t, p) {
    const out = cloneTable(t)
    const useRe = !!p.regex
    let re: RegExp | null = null
    if (useRe) {
      try {
        re = new RegExp(p.find, p.caseInsensitive ? 'gi' : 'g')
      } catch {
        re = null
      }
    }
    for (const c of pickColumns(out, p.columns)) {
      mapColumn(c, (v) => {
        if (isBlank(v)) return v
        const s = S(v)
        if (useRe && re) return s.replace(re, p.replaceWith ?? '')
        if (p.caseInsensitive) {
          const esc = String(p.find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          return s.replace(new RegExp(esc, 'gi'), p.replaceWith ?? '')
        }
        return s.split(p.find).join(p.replaceWith ?? '')
      })
    }
    return out
  },

  extract(t, p) {
    const out = cloneTable(t)
    const src = out.columns.find((c) => c.name === p.column)
    if (!src) return out
    let re: RegExp
    try {
      re = new RegExp(p.pattern)
    } catch {
      return out
    }
    const values = src.values.map((v) => {
      if (isBlank(v)) return null
      const m = S(v).match(re)
      return m ? (m[1] ?? m[0]) : null
    })
    out.columns.push({ id: uid('col'), name: p.into || `${p.column}_extract`, type: 'text', values })
    return out
  },

  splitColumn(t, p) {
    const out = cloneTable(t)
    const srcIdx = out.columns.findIndex((c) => c.name === p.column)
    if (srcIdx < 0) return out
    const src = out.columns[srcIdx]
    const parts = src.values.map((v) => (isBlank(v) ? [] : S(v).split(p.delimiter)))
    const maxParts = parts.reduce((m, a) => Math.max(m, a.length), 0)
    const newCols: Column[] = []
    for (let k = 0; k < maxParts; k++) {
      newCols.push({
        id: uid('col'),
        name: `${p.column}_${k + 1}`,
        type: 'text',
        values: parts.map((a) => a[k] ?? null)
      })
    }
    out.columns.splice(srcIdx + 1, 0, ...newCols)
    if (!p.keepOriginal) out.columns.splice(srcIdx, 1)
    return out
  },

  mergeColumns(t, p) {
    const out = cloneTable(t)
    const cols = pickColumns(out, p.columns)
    if (!cols.length) return out
    const values: CellValue[] = []
    for (let i = 0; i < out.nrows; i++) {
      values.push(cols.map((c) => S(c.values[i])).filter(Boolean).join(p.separator ?? ' '))
    }
    out.columns.push({ id: uid('col'), name: p.name || 'merged', type: 'text', values })
    return out
  },

  renameColumn(t, p) {
    const out = cloneTable(t)
    const c = out.columns.find((x) => x.name === p.column)
    if (c) c.name = p.name
    return out
  },

  deleteColumns(t, p) {
    const set = new Set<string>(p.columns)
    const out = cloneTable(t)
    out.columns = out.columns.filter((c) => !set.has(c.name))
    return out
  },

  moveColumn(t, p) {
    const out = cloneTable(t)
    const idx = out.columns.findIndex((c) => c.name === p.column)
    const j = idx + (p.dir as number)
    if (idx < 0 || j < 0 || j >= out.columns.length) return out
    const [c] = out.columns.splice(idx, 1)
    out.columns.splice(j, 0, c)
    return out
  },

  changeType(t, p) {
    const out = cloneTable(t)
    const c = out.columns.find((x) => x.name === p.column)
    if (c) {
      c.type = p.type
      mapColumn(c, (v) => coerce(v, p.type))
    }
    return out
  },

  filterRows(t, p) {
    const c = t.columns.find((x) => x.name === p.column)
    if (!c) return cloneTable(t)
    const val = p.value
    const num = parseFloat(val)
    const test = (cell: CellValue): boolean => {
      const s = S(cell)
      switch (p.op) {
        case 'eq':
          return s === S(val)
        case 'neq':
          return s !== S(val)
        case 'contains':
          return s.toLowerCase().includes(S(val).toLowerCase())
        case 'notContains':
          return !s.toLowerCase().includes(S(val).toLowerCase())
        case 'gt':
          return parseFloat(s) > num
        case 'lt':
          return parseFloat(s) < num
        case 'gte':
          return parseFloat(s) >= num
        case 'lte':
          return parseFloat(s) <= num
        case 'empty':
          return isBlank(cell)
        case 'notEmpty':
          return !isBlank(cell)
        default:
          return true
      }
    }
    const colIdx = t.columns.indexOf(c)
    return keepRows(t, (i) => test(t.columns[colIdx].values[i]))
  },

  removeEmptyRows(t) {
    return keepRows(t, (i) => t.columns.some((c) => !isBlank(c.values[i])))
  },

  removeEmptyColumns(t) {
    const out = cloneTable(t)
    out.columns = out.columns.filter((c) => c.values.some((v) => !isBlank(v)))
    return out
  },

  fillDown(t, p) {
    const out = cloneTable(t)
    for (const c of pickColumns(out, p.columns)) c.values = computeFill(c, 'down')
    return out
  },

  fillMissing(t, p) {
    const out = cloneTable(t)
    const c = out.columns.find((x) => x.name === p.column)
    if (c) c.values = computeFill(c, p.strategy as FillStrategy, p.value)
    return out
  },

  dedupeRows(t, p) {
    const keyCols: Column[] = p.columns?.length ? pickColumns(t, p.columns) : t.columns
    const seen = new Set<string>()
    return keepRows(t, (i) => {
      const key = keyCols.map((c) => S(c.values[i])).join('')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  },

  clusterMerge(t, p) {
    const out = cloneTable(t)
    const c = out.columns.find((x) => x.name === p.column)
    if (!c) return out
    const map: Record<string, string> = p.mapping ?? {}
    mapColumn(c, (v) => (isBlank(v) ? v : (map[S(v)] ?? v)))
    return out
  },

  standardizeDate(t, p) {
    const out = cloneTable(t)
    const c = out.columns.find((x) => x.name === p.column)
    if (c) {
      c.type = 'date'
      mapColumn(c, (v) => (isBlank(v) ? v : (normalizeDate(S(v)) ?? v)))
    }
    return out
  },

  parseField(t, p) {
    const out = cloneTable(t)
    const src = out.columns.find((x) => x.name === p.column)
    if (!src) return out
    const values = src.values.map((v) => applyParse(v, p.kind, p))
    if (p.into) {
      out.columns.push({ id: uid('col'), name: p.into, type: 'text', values })
    } else {
      src.values = values
    }
    return out
  },

  numberFormat(t, p) {
    const out = cloneTable(t)
    const c = out.columns.find((x) => x.name === p.column)
    if (c) {
      const d = p.decimals ?? 2
      mapColumn(c, (v) => {
        if (isBlank(v)) return v
        const n = typeof v === 'number' ? v : parseFloat(S(v).replace(/,/g, ''))
        return Number.isFinite(n) ? Number(n.toFixed(d)) : v
      })
    }
    return out
  },

  expression(t, p) {
    const out = cloneTable(t)
    let compiled
    try {
      compiled = compileExpression(p.expr)
    } catch {
      return out
    }
    const rowObj: Record<string, CellValue> = {}
    const target =
      p.mode === 'replace' ? out.columns.find((c) => c.name === p.target) : null
    const values: CellValue[] = []
    for (let i = 0; i < out.nrows; i++) {
      for (const c of out.columns) rowObj[c.name] = c.values[i]
      const cur = target ? target.values[i] : null
      values.push(compiled.eval({ value: cur, row: rowObj }))
    }
    if (target) {
      target.values = values
    } else {
      out.columns.push({ id: uid('col'), name: p.name || 'expr', type: 'text', values })
    }
    return out
  },

  fuzzyDedupe(t, p) {
    const keyCols: Column[] = p.columns?.length ? pickColumns(t, p.columns) : t.columns
    const colIdx = keyCols.map((c) => t.columns.indexOf(c))
    const threshold: number = p.threshold ?? 0.9
    const survivorship: string = p.survivorship ?? 'first'
    const keyOf = (i: number) =>
      colIdx
        .map((ci) => S(t.columns[ci].values[i]))
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    const blanks = (i: number) => t.columns.reduce((n, c) => n + (isBlank(c.values[i]) ? 1 : 0), 0)

    const keys = new Array(t.nrows).fill('').map((_, i) => keyOf(i))
    const removed = new Array(t.nrows).fill(false)
    // block by first character to cut comparisons
    const blocks = new Map<string, number[]>()
    for (let i = 0; i < t.nrows; i++) {
      const b = keys[i][0] ?? ''
      if (!blocks.has(b)) blocks.set(b, [])
      blocks.get(b)!.push(i)
    }
    for (const idxs of blocks.values()) {
      for (let a = 0; a < idxs.length; a++) {
        const i = idxs[a]
        if (removed[i]) continue
        for (let b = a + 1; b < idxs.length; b++) {
          const j = idxs[b]
          if (removed[j]) continue
          if (!keys[i] || !keys[j]) continue
          if (jaroWinkler(keys[i], keys[j]) >= threshold) {
            // decide survivor between i and j
            let survivor = i
            let victim = j
            if (survivorship === 'longest' && keys[j].length > keys[i].length) {
              survivor = j
              victim = i
            } else if (survivorship === 'mostComplete' && blanks(j) < blanks(i)) {
              survivor = j
              victim = i
            }
            removed[victim] = true
            if (victim === i) break // i gone, move on
          }
        }
      }
    }
    return keepRows(t, (i) => !removed[i])
  }
}

export function applyOp(t: Table, op: Op): Table {
  const h = HANDLERS[op.type]
  if (!h) return t
  try {
    return h(t, op.params)
  } catch {
    return t
  }
}
