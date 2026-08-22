import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Table } from '../engine/types'
import { useStore } from '../state/store'
import { ColumnTools } from './inspector/ColumnTools'
import { ClusterTool } from './inspector/ClusterTool'
import { FormulaTool } from './inspector/FormulaTool'
import { DatasetTool } from './inspector/DatasetTool'
import { SlidersHorizontal, Boxes, FunctionSquare, Database } from 'lucide-react'

type Tab = 'column' | 'cluster' | 'formula' | 'dataset'

export function Inspector({ table }: { table: Table }) {
  const selectedColumn = useStore((s) => s.selectedColumn)
  const [tab, setTab] = useState<Tab>('column')

  const needsColumn = tab !== 'dataset'
  const hasColumn = selectedColumn && table.columns.some((c) => c.name === selectedColumn)

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'column', icon: <SlidersHorizontal size={14} />, label: 'Column' },
    { id: 'cluster', icon: <Boxes size={14} />, label: 'Cluster' },
    { id: 'formula', icon: <FunctionSquare size={14} />, label: 'Formula' },
    { id: 'dataset', icon: <Database size={14} />, label: 'Dataset' }
  ]

  return (
    <div className="pane right glass">
      <div className="itabs">
        {tabs.map((t) => (
          <button key={t.id} className={'itab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="pane-scroll" style={{ padding: '4px 15px 24px' }}>
        {needsColumn && !hasColumn && (
          <div className="pick-hint">
            <SlidersHorizontal size={22} strokeWidth={1.4} />
            <p>Select a column header to clean it.</p>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab + (hasColumn ? selectedColumn : '')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {tab === 'column' && hasColumn && <ColumnTools table={table} column={selectedColumn!} />}
            {tab === 'cluster' && hasColumn && <ClusterTool table={table} column={selectedColumn!} />}
            {tab === 'formula' && hasColumn && <FormulaTool table={table} column={selectedColumn!} />}
            {tab === 'dataset' && <DatasetTool table={table} />}
          </motion.div>
        </AnimatePresence>
      </div>
      <style>{css}</style>
    </div>
  )
}

const css = `
.itabs { display: flex; padding: 8px; gap: 3px; border-bottom: 1px solid var(--hairline); }
.itab {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
  border: none; background: transparent; color: var(--text-2);
  font-family: inherit; font-size: 10.5px; font-weight: 560; padding: 7px 4px;
  border-radius: 10px; cursor: default; transition: all 0.14s;
}
.itab:hover { background: var(--hover); }
.itab.on { background: var(--active); color: var(--accent); }
.pick-hint { text-align: center; color: var(--text-3); padding: 44px 20px; }
.pick-hint svg { color: var(--accent); opacity: 0.7; margin-bottom: 10px; }
.pick-hint p { font-size: 12.5px; color: var(--text-2); }
`
