import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { CellValue, Table } from './types'
import { tableFromRows, tableToRows } from './dataframe'

export type ImportFormat = 'csv' | 'tsv' | 'xlsx' | 'json'

export function detectFormat(name: string): ImportFormat {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (ext === 'json') return 'json'
  if (ext === 'tsv') return 'tsv'
  return 'csv'
}

export function parseData(name: string, bytes: ArrayBuffer, text?: string): Table {
  const fmt = detectFormat(name)
  if (fmt === 'xlsx') {
    const wb = XLSX.read(bytes, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: null })
    if (!rows.length) return tableFromRows([], [])
    const header = (rows[0] as any[]).map((h) => (h == null ? '' : String(h)))
    const body = rows.slice(1).map((r) => (r as any[]).map((v) => (v === undefined ? null : v)))
    return tableFromRows(header, body as CellValue[][])
  }
  const content = text ?? new TextDecoder().decode(bytes)
  if (fmt === 'json') {
    const data = JSON.parse(content)
    const arr: any[] = Array.isArray(data) ? data : [data]
    const header = Array.from(
      arr.reduce((set: Set<string>, row) => {
        Object.keys(row ?? {}).forEach((k) => set.add(k))
        return set
      }, new Set<string>())
    )
    const body = arr.map((row) => header.map((h) => (row?.[h] ?? null) as CellValue))
    return tableFromRows(header, body)
  }
  const delimiter = fmt === 'tsv' ? '\t' : ''
  const res = Papa.parse<string[]>(content, {
    delimiter,
    skipEmptyLines: 'greedy'
  })
  const rows = res.data as unknown as string[][]
  if (!rows.length) return tableFromRows([], [])
  const header = rows[0].map((h) => (h == null ? '' : String(h)))
  return tableFromRows(header, rows.slice(1) as CellValue[][])
}

export function toCSV(t: Table, delimiter = ','): string {
  const { header, rows } = tableToRows(t)
  return Papa.unparse({ fields: header, data: rows as any[][] }, { delimiter })
}

export function toJSON(t: Table): string {
  const { header, rows } = tableToRows(t)
  const objs = rows.map((r) => {
    const o: Record<string, CellValue> = {}
    header.forEach((h, i) => (o[h] = r[i]))
    return o
  })
  return JSON.stringify(objs, null, 2)
}

export function toXLSX(t: Table): ArrayBuffer {
  const { header, rows } = tableToRows(t)
  const aoa = [header, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tidyset')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
