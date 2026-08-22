// Deterministic "smart suggestions": scan the table with rules (no AI) and
// propose one-click cleaning steps. Each suggestion carries a ready-to-apply Op.
import { Op, Table } from './types'
import { isBlank, normalizeDate } from './dataframe'

export interface Suggestion {
  id: string
  title: string
  detail: string
  icon: string // lucide icon name
  opType: Op['type']
  params: Record<string, any>
}

const S = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function suggestFixes(t: Table): Suggestion[] {
  const out: Suggestion[] = []
  if (t.nrows === 0) return out

  // 1. Whitespace to trim
  const dirty = t.columns.filter((c) =>
    c.values.some((v) => typeof v === 'string' && (v !== v.trim() || /\s{2,}/.test(v)))
  )
  if (dirty.length) {
    out.push({
      id: 'trim',
      title: `Trim whitespace`,
      detail: `${dirty.length} column${dirty.length === 1 ? '' : 's'} with stray spaces`,
      icon: 'Eraser',
      opType: 'trim',
      params: { columns: dirty.map((c) => c.name) }
    })
  }

  // 2. Empty rows
  let emptyRows = 0
  for (let i = 0; i < t.nrows; i++) if (t.columns.every((c) => isBlank(c.values[i]))) emptyRows++
  if (emptyRows) {
    out.push({
      id: 'emptyrows',
      title: `Remove ${emptyRows} empty row${emptyRows === 1 ? '' : 's'}`,
      detail: 'Rows with no values at all',
      icon: 'Rows3',
      opType: 'removeEmptyRows',
      params: {}
    })
  }

  // 3. Empty columns
  const emptyCols = t.columns.filter((c) => c.values.every((v) => isBlank(v)))
  if (emptyCols.length) {
    out.push({
      id: 'emptycols',
      title: `Remove ${emptyCols.length} empty column${emptyCols.length === 1 ? '' : 's'}`,
      detail: emptyCols.map((c) => c.name).join(', '),
      icon: 'Columns3',
      opType: 'removeEmptyColumns',
      params: {}
    })
  }

  // 4. Exact duplicate rows
  const seen = new Set<string>()
  let dups = 0
  for (let i = 0; i < t.nrows; i++) {
    const key = t.columns.map((c) => S(c.values[i])).join('')
    if (seen.has(key)) dups++
    else seen.add(key)
  }
  if (dups) {
    out.push({
      id: 'dups',
      title: `Remove ${dups} duplicate row${dups === 1 ? '' : 's'}`,
      detail: 'Exact duplicates across all columns',
      icon: 'CopyMinus',
      opType: 'dedupeRows',
      params: {}
    })
  }

  // 5. Date columns not in ISO form
  for (const c of t.columns) {
    if (c.type === 'date') continue
    let nonBlank = 0
    let dateLike = 0
    let needsFix = 0
    for (const v of c.values) {
      if (isBlank(v)) continue
      nonBlank++
      const iso = normalizeDate(S(v))
      if (iso) {
        dateLike++
        if (iso !== S(v)) needsFix++
      }
    }
    if (nonBlank >= 3 && dateLike / nonBlank >= 0.7 && needsFix > 0) {
      out.push({
        id: 'date_' + c.name,
        title: `Standardise dates in “${c.name}”`,
        detail: `${needsFix} value${needsFix === 1 ? '' : 's'} in mixed formats → ISO`,
        icon: 'Calendar',
        opType: 'standardizeDate',
        params: { column: c.name }
      })
    }
  }

  // 6. Inconsistent capitalisation / spacing variants (case-only duplicates)
  for (const c of t.columns) {
    if (c.type !== 'text') continue
    const groups = new Map<string, Map<string, number>>()
    for (const v of c.values) {
      if (isBlank(v)) continue
      const raw = S(v)
      const key = raw.trim().toLowerCase()
      if (!groups.has(key)) groups.set(key, new Map())
      const g = groups.get(key)!
      g.set(raw, (g.get(raw) ?? 0) + 1)
    }
    const mapping: Record<string, string> = {}
    let variantGroups = 0
    for (const g of groups.values()) {
      if (g.size < 2) continue
      variantGroups++
      // canonical = most-frequent variant, normalised so we never reintroduce whitespace
      const rawCanonical = [...g.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const canonical = rawCanonical.trim().replace(/\s+/g, ' ')
      for (const raw of g.keys()) if (raw !== canonical) mapping[raw] = canonical
    }
    if (variantGroups > 0 && Object.keys(mapping).length) {
      out.push({
        id: 'case_' + c.name,
        title: `Unify values in “${c.name}”`,
        detail: `${variantGroups} value${variantGroups === 1 ? '' : 's'} written inconsistently`,
        icon: 'Boxes',
        opType: 'clusterMerge',
        params: { column: c.name, mapping }
      })
    }
  }

  return out
}
