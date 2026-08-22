import { CellValue, ColType, Column, Table, uid } from './types'

// ---- Type inference ---------------------------------------------------------

const INT_RE = /^-?\d{1,15}$/
const DEC_RE = /^-?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?$/
const BOOL_TRUE = new Set(['true', 'yes', 'y', '1'])
const BOOL_FALSE = new Set(['false', 'no', 'n', '0'])

// A battery of accepted date formats -> normaliser. Deterministic, no AI.
const DATE_PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => string | null }[] = [
  // ISO 2024-01-31 or 2024/01/31
  { re: /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/, build: (m) => iso(+m[1], +m[2], +m[3]) },
  // DD-MM-YYYY / DD.MM.YYYY (day first, European)
  { re: /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/, build: (m) => euroOrUs(+m[1], +m[2], +m[3]) },
  // 31 Jan 2024 / Jan 31, 2024
  { re: /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/, build: (m) => iso(+m[3], monthIdx(m[2]), +m[1]) },
  { re: /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/, build: (m) => iso(+m[3], monthIdx(m[1]), +m[2]) }
]

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}
function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}
function euroOrUs(a: number, b: number, y: number): string | null {
  // prefer day-first (European); fall back if impossible
  if (a > 12 && b <= 12) return iso(y, b, a)
  if (b > 12 && a <= 12) return iso(y, a, b)
  return iso(y, b, a) // ambiguous -> day-first
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function monthIdx(s: string): number {
  return MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1
}

export function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  for (const p of DATE_PATTERNS) {
    const m = s.match(p.re)
    if (m) {
      const out = p.build(m)
      if (out) return out
    }
  }
  return null
}

export function detectType(values: CellValue[]): ColType {
  let n = 0
  let ints = 0
  let decs = 0
  let bools = 0
  let dates = 0
  for (const v of values) {
    if (v === null || v === '') continue
    const s = String(v).trim()
    n++
    if (INT_RE.test(s)) ints++
    if (DEC_RE.test(s)) decs++
    const low = s.toLowerCase()
    if (BOOL_TRUE.has(low) || BOOL_FALSE.has(low)) bools++
    if (normalizeDate(s)) dates++
  }
  if (n === 0) return 'text'
  const frac = (x: number) => x / n
  if (frac(bools) === 1) return 'boolean'
  if (frac(ints) >= 0.95) return 'integer'
  if (frac(decs) >= 0.95) return 'decimal'
  if (frac(dates) >= 0.9) return 'date'
  return 'text'
}

export function coerce(v: CellValue, type: ColType): CellValue {
  if (v === null || v === '') return null
  const s = String(v).trim()
  switch (type) {
    case 'integer': {
      const n = parseInt(s.replace(/,/g, ''), 10)
      return Number.isFinite(n) ? n : v
    }
    case 'decimal': {
      const n = parseFloat(s.replace(/,/g, ''))
      return Number.isFinite(n) ? n : v
    }
    case 'boolean': {
      const low = s.toLowerCase()
      if (BOOL_TRUE.has(low)) return true
      if (BOOL_FALSE.has(low)) return false
      return v
    }
    case 'date':
      return normalizeDate(s) ?? v
    default:
      return s
  }
}

// ---- Build a Table from parsed rows -----------------------------------------

export function tableFromRows(header: string[], rows: CellValue[][]): Table {
  const columns: Column[] = header.map((name, ci) => {
    const values: CellValue[] = rows.map((r) => {
      const raw = r[ci]
      if (raw === undefined || raw === null) return null
      return raw
    })
    const type = detectType(values)
    return { id: uid('col'), name: name || `Column ${ci + 1}`, type, values }
  })
  return { columns, nrows: rows.length }
}

export function tableToRows(t: Table): { header: string[]; rows: CellValue[][] } {
  const header = t.columns.map((c) => c.name)
  const rows: CellValue[][] = []
  for (let i = 0; i < t.nrows; i++) {
    rows.push(t.columns.map((c) => c.values[i] ?? null))
  }
  return { header, rows }
}

export function isBlank(v: CellValue): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** Fraction of non-blank cells in a column, 0..1. Powers the header quality bar. */
export function completeness(values: CellValue[]): number {
  if (values.length === 0) return 1
  let filled = 0
  for (const v of values) if (!isBlank(v)) filled++
  return filled / values.length
}
