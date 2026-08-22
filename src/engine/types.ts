// Tidyset engine — core types. Everything here is pure, deterministic, offline.

export type CellValue = string | number | boolean | null

export type ColType = 'text' | 'integer' | 'decimal' | 'date' | 'boolean'

export interface Column {
  id: string
  name: string
  type: ColType
  values: CellValue[]
}

export interface Table {
  columns: Column[]
  nrows: number
}

/** A single reversible step in the recipe. Params are fully serialisable. */
export interface Op {
  id: string
  type: OpType
  label: string
  enabled: boolean
  params: Record<string, any>
}

export type OpType =
  | 'trim'
  | 'changeCase'
  | 'replace'
  | 'extract'
  | 'splitColumn'
  | 'mergeColumns'
  | 'renameColumn'
  | 'deleteColumns'
  | 'moveColumn'
  | 'changeType'
  | 'filterRows'
  | 'removeEmptyRows'
  | 'removeEmptyColumns'
  | 'fillDown'
  | 'fillMissing'
  | 'dedupeRows'
  | 'clusterMerge'
  | 'fuzzyDedupe'
  | 'standardizeDate'
  | 'parseField'
  | 'numberFormat'
  | 'expression'

/** A saved recipe file (.tidyset) */
export interface Recipe {
  app: 'tidyset'
  version: 1
  name: string
  createdAt: string
  ops: Op[]
}

export function uid(prefix = 'id'): string {
  // deterministic-enough unique id without Math.random dependency at module load
  uidCounter += 1
  return `${prefix}_${uidCounter.toString(36)}_${Date.now().toString(36)}`
}
let uidCounter = 0

export function emptyTable(): Table {
  return { columns: [], nrows: 0 }
}

export function cloneTable(t: Table): Table {
  return {
    nrows: t.nrows,
    columns: t.columns.map((c) => ({ ...c, values: c.values.slice() }))
  }
}

export function columnByName(t: Table, name: string): Column | undefined {
  return t.columns.find((c) => c.name === name)
}
