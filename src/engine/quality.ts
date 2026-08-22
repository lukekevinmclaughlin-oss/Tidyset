// Deterministic data-quality scoring for the health dashboard.
import { Table } from './types'
import { isBlank, detectType } from './dataframe'

export interface ColumnHealth {
  name: string
  completeness: number // 0..1
  issues: string[]
}

export interface Quality {
  score: number // 0..100
  completeness: number // 0..1 overall
  duplicateRows: number
  totalCells: number
  emptyCells: number
  columns: ColumnHealth[]
}

const S = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function datasetQuality(t: Table): Quality {
  const totalCells = t.nrows * t.columns.length
  let emptyCells = 0
  const columns: ColumnHealth[] = []
  let columnsWithIssues = 0

  for (const c of t.columns) {
    let blank = 0
    let whitespace = 0
    const caseKeys = new Map<string, Set<string>>()
    for (const v of c.values) {
      if (isBlank(v)) {
        blank++
        continue
      }
      if (typeof v === 'string' && (v !== v.trim() || /\s{2,}/.test(v))) whitespace++
      if (c.type === 'text') {
        const raw = S(v)
        const key = raw.trim().toLowerCase()
        if (!caseKeys.has(key)) caseKeys.set(key, new Set())
        caseKeys.get(key)!.add(raw)
      }
    }
    emptyCells += blank
    const filled = c.values.length - blank
    const completeness = c.values.length ? filled / c.values.length : 1

    // does the detected type of the filled values disagree with the column type?
    const nonBlank = c.values.filter((v) => !isBlank(v))
    const detected = detectType(nonBlank)
    const typeMixed = nonBlank.length > 0 && detected !== c.type && !(c.type === 'text')

    const issues: string[] = []
    if (blank > 0) issues.push(`${blank} blank`)
    if (whitespace > 0) issues.push(`${whitespace} with stray spaces`)
    const variantGroups = [...caseKeys.values()].filter((s) => s.size > 1).length
    if (variantGroups > 0) issues.push(`${variantGroups} inconsistent value${variantGroups === 1 ? '' : 's'}`)
    if (typeMixed) issues.push(`looks like ${detected}`)

    if (issues.length) columnsWithIssues++
    columns.push({ name: c.name, completeness, issues })
  }

  // duplicate rows
  const seen = new Set<string>()
  let duplicateRows = 0
  for (let i = 0; i < t.nrows; i++) {
    const key = t.columns.map((c) => S(c.values[i])).join('')
    if (seen.has(key)) duplicateRows++
    else seen.add(key)
  }

  const completeness = totalCells ? (totalCells - emptyCells) / totalCells : 1
  const penalty = Math.min(15, duplicateRows * 3) + Math.min(20, columnsWithIssues * 4)
  const score = Math.max(0, Math.round(completeness * 100 - penalty))

  return { score, completeness, duplicateRows, totalCells, emptyCells, columns }
}
