import { CellValue, Column } from './types'
import { isBlank } from './dataframe'

export type FillStrategy = 'down' | 'up' | 'constant' | 'mean' | 'median' | 'mode'

function numbers(values: CellValue[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (isBlank(v)) continue
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

export function computeFill(col: Column, strategy: FillStrategy, constant?: CellValue): CellValue[] {
  const values = col.values.slice()
  switch (strategy) {
    case 'down': {
      let last: CellValue = null
      for (let i = 0; i < values.length; i++) {
        if (isBlank(values[i])) values[i] = last
        else last = values[i]
      }
      return values
    }
    case 'up': {
      let next: CellValue = null
      for (let i = values.length - 1; i >= 0; i--) {
        if (isBlank(values[i])) values[i] = next
        else next = values[i]
      }
      return values
    }
    case 'constant':
      return values.map((v) => (isBlank(v) ? (constant ?? null) : v))
    case 'mean': {
      const ns = numbers(values)
      if (!ns.length) return values
      const mean = ns.reduce((a, b) => a + b, 0) / ns.length
      const rounded = Math.round(mean * 1e6) / 1e6
      return values.map((v) => (isBlank(v) ? rounded : v))
    }
    case 'median': {
      const ns = numbers(values).sort((a, b) => a - b)
      if (!ns.length) return values
      const mid = Math.floor(ns.length / 2)
      const med = ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2
      return values.map((v) => (isBlank(v) ? med : v))
    }
    case 'mode': {
      const counts = new Map<string, number>()
      let best: CellValue = null
      let bestN = 0
      for (const v of values) {
        if (isBlank(v)) continue
        const k = String(v)
        const n = (counts.get(k) ?? 0) + 1
        counts.set(k, n)
        if (n > bestN) {
          bestN = n
          best = v
        }
      }
      return values.map((v) => (isBlank(v) ? best : v))
    }
    default:
      return values
  }
}
