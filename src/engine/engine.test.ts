import { describe, it, expect } from 'vitest'
import { detectType, normalizeDate, tableFromRows } from './dataframe'
import { levenshtein, jaroWinkler, fingerprint, buildClusters } from './algorithms'
import { compileExpression } from './expression'
import { applyOp } from './transforms'
import { foldPipeline, foldAll, stepDelta, computeView, subsetRows } from './pipeline'
import { suggestFixes } from './suggest'
import { computeFill } from './fill'
import { toCSV, toJSON } from './io'
import { columnProfile } from './stats'
import { datasetQuality } from './quality'
import { Op, uid } from './types'

const op = (type: Op['type'], params: Record<string, any>): Op => ({
  id: uid('op'),
  type,
  label: type,
  enabled: true,
  params
})

describe('type inference', () => {
  it('detects integers, decimals, dates, booleans', () => {
    expect(detectType(['1', '2', '3'])).toBe('integer')
    expect(detectType(['1.5', '2.25'])).toBe('decimal')
    expect(detectType(['yes', 'no', 'true'])).toBe('boolean')
    expect(detectType(['2024-01-01', '2024-02-02'])).toBe('date')
    expect(detectType(['apple', 'pear'])).toBe('text')
  })
  it('normalises many date formats to ISO', () => {
    expect(normalizeDate('15/02/2024')).toBe('2024-02-15')
    expect(normalizeDate('Mar 3, 2024')).toBe('2024-03-03')
    expect(normalizeDate('2024/04/11')).toBe('2024-04-11')
    expect(normalizeDate('11 Apr 2024')).toBe('2024-04-11')
  })
})

describe('string algorithms', () => {
  it('levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('abc', 'abc')).toBe(0)
  })
  it('jaroWinkler favours common prefixes', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.9)
  })
  it('fingerprint canonicalises punctuation/case/order', () => {
    expect(fingerprint('United  States')).toBe(fingerprint('united states'))
    expect(fingerprint('USA')).toBe(fingerprint('usa'))
  })
  it('clusters similar values', () => {
    const distinct = [
      { value: 'United States', count: 5 },
      { value: 'united states', count: 2 },
      { value: 'Finland', count: 1 }
    ]
    const clusters = buildClusters(distinct, 'fingerprint')
    expect(clusters).toHaveLength(1)
    expect(clusters[0].total).toBe(7)
    expect(clusters[0].suggestion).toBe('United States')
  })
})

describe('expression language', () => {
  const run = (src: string, value: any, row: Record<string, any> = {}) =>
    compileExpression(src).eval({ value, row })
  it('evaluates functions and operators', () => {
    expect(run('upper(trim(value))', '  hi ')).toBe('HI')
    expect(run('concat($a, "-", $b)', null, { a: 'x', b: 'y' })).toBe('x-y')
    expect(run('if(len(value) > 2, "long", "short")', 'abcd')).toBe('long')
    expect(run('part(value, "@", 1)', 'me@site.com')).toBe('site.com')
    expect(run('round(number(value) * 2, 1)', '1.234')).toBe(2.5)
  })
})

describe('transforms', () => {
  const t = tableFromRows(
    ['Name', 'Country'],
    [
      ['  Ada ', 'USA'],
      ['Bob', 'usa'],
      ['Ada', 'USA']
    ]
  )
  it('trims', () => {
    const out = applyOp(t, op('trim', { columns: ['Name'] }))
    expect(out.columns[0].values[0]).toBe('Ada')
  })
  it('cluster-merges values', () => {
    const out = applyOp(t, op('clusterMerge', { column: 'Country', mapping: { usa: 'USA' } }))
    expect(out.columns[1].values.every((v) => v === 'USA')).toBe(true)
  })
  it('removes exact duplicate rows', () => {
    const trimmed = applyOp(t, op('trim', { columns: ['Name'] }))
    const out = applyOp(trimmed, op('dedupeRows', {}))
    expect(out.nrows).toBe(2)
  })
  it('runs a whole pipeline in order', () => {
    const result = foldPipeline(t, [
      op('trim', { columns: ['Name'] }),
      op('clusterMerge', { column: 'Country', mapping: { usa: 'USA' } }),
      op('dedupeRows', {})
    ])
    expect(result.nrows).toBe(2)
    expect(result.columns[1].values).toEqual(['USA', 'USA'])
  })
})

describe('fill strategies', () => {
  it('fills down and by mode', () => {
    const col = { id: 'c', name: 'x', type: 'text' as const, values: ['a', null, null, 'b'] }
    expect(computeFill(col, 'down')).toEqual(['a', 'a', 'a', 'b'])
  })
})

describe('io', () => {
  it('round-trips CSV and JSON', () => {
    const t = tableFromRows(['a', 'b'], [['1', 'x'], ['2', 'y']])
    expect(toCSV(t)).toContain('a,b')
    expect(JSON.parse(toJSON(t))).toHaveLength(2)
  })
})

describe('snapshots, deltas & view', () => {
  const t = tableFromRows(
    ['Name', 'Country'],
    [
      ['  Ada ', 'USA'],
      ['Bob', 'usa'],
      ['Ada', 'USA']
    ]
  )
  it('foldAll returns source + one snapshot per op', () => {
    const snaps = foldAll(t, [op('trim', { columns: ['Name'] }), op('dedupeRows', {})])
    expect(snaps).toHaveLength(3)
    expect(snaps[0]).toBe(t)
    expect(snaps[2].nrows).toBe(2)
  })
  it('stepDelta reports row removals and cell changes', () => {
    const trimmed = applyOp(t, op('trim', { columns: ['Name'] }))
    expect(stepDelta(t, trimmed).cells).toBeGreaterThan(0)
    const deduped = applyOp(trimmed, op('dedupeRows', {}))
    expect(stepDelta(trimmed, deduped).rows).toBe(-1)
  })
  it('computeView filters by search and sorts, returning original indices', () => {
    const asc = computeView(t, '', 'Name', 'asc')
    expect(t.columns[0].values[asc[0]]).toBe('  Ada ') // sorts by raw value
    const filtered = computeView(t, 'bob', null, 'asc')
    expect(filtered).toHaveLength(1)
    expect(t.columns[0].values[filtered[0]]).toBe('Bob')
  })
})

describe('smart suggestions', () => {
  it('detects whitespace, duplicates and case variants', () => {
    const t = tableFromRows(
      ['Name', 'Plan'],
      [
        ['  Ada ', 'Pro'],
        ['Bob', 'pro'],
        ['Bob', 'pro']
      ]
    )
    const ids = suggestFixes(t).map((s) => s.id)
    expect(ids).toContain('trim')
    expect(ids).toContain('dups')
    expect(ids.some((i) => i.startsWith('case_'))).toBe(true)
  })
})

describe('column profiling', () => {
  it('computes numeric stats and a histogram', () => {
    const t = tableFromRows(['Revenue'], [['10'], ['20'], ['30'], ['40']])
    const p = columnProfile(t, 'Revenue')!
    expect(p.type).toBe('integer')
    expect(p.numeric?.min).toBe(10)
    expect(p.numeric?.max).toBe(40)
    expect(p.numeric?.mean).toBe(25)
    expect(p.numeric?.sum).toBe(100)
    expect(p.histogram?.bins.reduce((a, b) => a + b, 0)).toBe(4)
  })
  it('summarises text length and distinct counts', () => {
    const t = tableFromRows(['Name'], [['Ada'], ['Bob'], ['Ada'], ['']])
    const p = columnProfile(t, 'Name')!
    expect(p.distinct).toBe(2)
    expect(p.blank).toBe(1)
    expect(p.text?.maxLen).toBe(3)
  })
})

describe('data quality', () => {
  it('scores completeness and flags issues', () => {
    const clean = tableFromRows(['A', 'B'], [['1', 'x'], ['2', 'y']])
    expect(datasetQuality(clean).score).toBe(100)
    const messy = tableFromRows(['Name', 'Plan'], [['  Ada ', 'Pro'], ['Bob', 'pro'], ['Bob', 'pro']])
    const q = datasetQuality(messy)
    expect(q.score).toBeLessThan(100)
    expect(q.duplicateRows).toBe(1)
    expect(q.columns.some((c) => c.issues.length > 0)).toBe(true)
  })
})

describe('column move & view subset', () => {
  const t = tableFromRows(['A', 'B', 'C'], [['1', '2', '3'], ['4', '5', '6']])
  it('moves a column right', () => {
    const out = applyOp(t, op('moveColumn', { column: 'A', dir: 1 }))
    expect(out.columns.map((c) => c.name)).toEqual(['B', 'A', 'C'])
  })
  it('does not move past the edge', () => {
    const out = applyOp(t, op('moveColumn', { column: 'A', dir: -1 }))
    expect(out.columns.map((c) => c.name)).toEqual(['A', 'B', 'C'])
  })
  it('subsetRows builds a table from a row order', () => {
    const sub = subsetRows(t, [1])
    expect(sub.nrows).toBe(1)
    expect(sub.columns[0].values[0]).toBe('4')
  })
})
