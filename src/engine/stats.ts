// Deterministic column profiling: numeric distribution, text/date summaries.
import { CellValue, ColType, Table } from './types'
import { isBlank, normalizeDate } from './dataframe'

export interface NumericStats {
  min: number
  max: number
  mean: number
  median: number
  sum: number
  std: number
}

export interface Profile {
  name: string
  type: ColType
  total: number
  filled: number
  blank: number
  distinct: number
  numeric?: NumericStats
  histogram?: { bins: number[]; min: number; max: number }
  text?: { minLen: number; maxLen: number; avgLen: number }
  date?: { min: string; max: string }
}

function toNumbers(values: CellValue[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (isBlank(v)) continue
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function numericStats(ns: number[]): NumericStats {
  const sorted = ns.slice().sort((a, b) => a - b)
  const sum = ns.reduce((a, b) => a + b, 0)
  const mean = sum / ns.length
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const variance = ns.reduce((a, b) => a + (b - mean) ** 2, 0) / ns.length
  return { min: sorted[0], max: sorted[sorted.length - 1], mean, median, sum, std: Math.sqrt(variance) }
}

function histogram(ns: number[], binCount = 14): { bins: number[]; min: number; max: number } {
  const min = Math.min(...ns)
  const max = Math.max(...ns)
  const bins = new Array(binCount).fill(0)
  if (max === min) {
    bins[0] = ns.length
    return { bins, min, max }
  }
  const width = (max - min) / binCount
  for (const n of ns) {
    let idx = Math.floor((n - min) / width)
    if (idx >= binCount) idx = binCount - 1
    if (idx < 0) idx = 0
    bins[idx]++
  }
  return { bins, min, max }
}

export function columnProfile(t: Table, name: string): Profile | null {
  const col = t.columns.find((c) => c.name === name)
  if (!col) return null
  let filled = 0
  const distinct = new Set<string>()
  for (const v of col.values) {
    if (isBlank(v)) continue
    filled++
    distinct.add(String(v))
  }
  const prof: Profile = {
    name,
    type: col.type,
    total: col.values.length,
    filled,
    blank: col.values.length - filled,
    distinct: distinct.size
  }

  if (col.type === 'integer' || col.type === 'decimal') {
    const ns = toNumbers(col.values)
    if (ns.length) {
      prof.numeric = numericStats(ns)
      prof.histogram = histogram(ns)
    }
  } else if (col.type === 'date') {
    const isos: string[] = []
    for (const v of col.values) {
      if (isBlank(v)) continue
      const iso = normalizeDate(String(v)) ?? String(v)
      isos.push(iso)
    }
    isos.sort()
    if (isos.length) prof.date = { min: isos[0], max: isos[isos.length - 1] }
  } else {
    let minLen = Infinity
    let maxLen = 0
    let sumLen = 0
    let n = 0
    for (const v of col.values) {
      if (isBlank(v)) continue
      const len = String(v).length
      minLen = Math.min(minLen, len)
      maxLen = Math.max(maxLen, len)
      sumLen += len
      n++
    }
    if (n) prof.text = { minLen: minLen === Infinity ? 0 : minLen, maxLen, avgLen: sumLen / n }
  }
  return prof
}
