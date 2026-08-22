import { create } from 'zustand'
import { Op, Table, uid } from '../engine/types'

export type ThemeMode = 'light' | 'dark'
export type SortDir = 'asc' | 'desc'
export interface Toast {
  id: string
  msg: string
  kind: 'info' | 'success' | 'error'
}

interface AppState {
  source: Table | null
  fileName: string
  ops: Op[]
  past: Op[][]
  future: Op[][]
  selectedOpId: string | null
  selectedColumn: string | null
  theme: ThemeMode
  proUnlocked: boolean

  // view-only state (not part of the recipe)
  sortCol: string | null
  sortDir: SortDir
  search: string
  toasts: Toast[]

  loadTable: (name: string, table: Table) => void
  addOp: (type: Op['type'], label: string, params: Record<string, any>) => void
  updateOp: (id: string, patch: Partial<Op>) => void
  removeOp: (id: string) => void
  toggleOp: (id: string) => void
  moveOp: (id: string, dir: -1 | 1) => void
  selectOp: (id: string | null) => void
  selectColumn: (name: string | null) => void
  setOps: (ops: Op[]) => void
  clearAll: () => void
  setTheme: (t: ThemeMode) => void

  undo: () => void
  redo: () => void
  cycleSort: (col: string) => void
  setSearch: (s: string) => void
  notify: (msg: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
}

export const useStore = create<AppState>((set, get) => {
  // route every recipe mutation through history
  const commit = (ops: Op[], extra: Partial<AppState> = {}) =>
    set((s) => ({ past: [...s.past, s.ops], future: [], ops, ...extra }))

  return {
    source: null,
    fileName: '',
    ops: [],
    past: [],
    future: [],
    selectedOpId: null,
    selectedColumn: null,
    theme: 'light',
    proUnlocked: true,
    sortCol: null,
    sortDir: 'asc',
    search: '',
    toasts: [],

    loadTable: (name, table) =>
      set({
        source: table,
        fileName: name,
        ops: [],
        past: [],
        future: [],
        selectedOpId: null,
        selectedColumn: table.columns[0]?.name ?? null,
        sortCol: null,
        search: ''
      }),

    addOp: (type, label, params) => {
      const op: Op = { id: uid('op'), type, label, enabled: true, params }
      commit([...get().ops, op], { selectedOpId: op.id })
    },

    updateOp: (id, patch) => commit(get().ops.map((o) => (o.id === id ? { ...o, ...patch } : o))),

    removeOp: (id) =>
      commit(
        get().ops.filter((o) => o.id !== id),
        { selectedOpId: get().selectedOpId === id ? null : get().selectedOpId }
      ),

    toggleOp: (id) => commit(get().ops.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o))),

    moveOp: (id, dir) => {
      const ops = get().ops
      const idx = ops.findIndex((o) => o.id === id)
      const j = idx + dir
      if (idx < 0 || j < 0 || j >= ops.length) return
      const next = ops.slice()
      ;[next[idx], next[j]] = [next[j], next[idx]]
      commit(next)
    },

    selectOp: (id) => set({ selectedOpId: id }),
    selectColumn: (name) => set({ selectedColumn: name }),
    setOps: (ops) => commit(ops, { selectedOpId: null }),
    clearAll: () =>
      set({
        source: null,
        fileName: '',
        ops: [],
        past: [],
        future: [],
        selectedOpId: null,
        selectedColumn: null,
        search: '',
        sortCol: null
      }),
    setTheme: (t) => set({ theme: t }),

    undo: () => {
      const { past, ops, future } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      set({ ops: prev, past: past.slice(0, -1), future: [ops, ...future], selectedOpId: null })
    },
    redo: () => {
      const { past, ops, future } = get()
      if (!future.length) return
      const next = future[0]
      set({ ops: next, future: future.slice(1), past: [...past, ops], selectedOpId: null })
    },

    cycleSort: (col) => {
      const { sortCol, sortDir } = get()
      if (sortCol !== col) set({ sortCol: col, sortDir: 'asc' })
      else if (sortDir === 'asc') set({ sortDir: 'desc' })
      else set({ sortCol: null, sortDir: 'asc' })
    },
    setSearch: (s) => set({ search: s }),

    notify: (msg, kind = 'info') =>
      set((s) => ({ toasts: [...s.toasts, { id: uid('toast'), msg, kind }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
})
