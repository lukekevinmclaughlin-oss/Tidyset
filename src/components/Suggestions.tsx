import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Sparkles,
  Eraser,
  Rows3,
  Columns3,
  CopyMinus,
  Calendar,
  Boxes,
  Wand2,
  X,
  Check
} from 'lucide-react'
import { Table } from '../engine/types'
import { suggestFixes } from '../engine/suggest'
import { useStore } from '../state/store'

const ICONS: Record<string, any> = { Eraser, Rows3, Columns3, CopyMinus, Calendar, Boxes, Wand2 }

export function Suggestions({ table }: { table: Table }) {
  const addOp = useStore((s) => s.addOp)
  const notify = useStore((s) => s.notify)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState(false)

  const suggestions = useMemo(() => suggestFixes(table).filter((s) => !dismissed.has(s.id)), [table, dismissed])

  if (suggestions.length === 0) return null

  const applyOne = (s: (typeof suggestions)[number]) => {
    addOp(s.opType, s.title, s.params)
    notify(s.title, 'success')
  }
  const applyAll = () => {
    suggestions.forEach((s) => addOp(s.opType, s.title, s.params))
    notify(`Applied ${suggestions.length} suggested fixes`, 'success')
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="suggest-bar glass"
    >
      <div className="suggest-head" onClick={() => setCollapsed((c) => !c)}>
        <Sparkles size={15} className="sg-spark" />
        <b>{suggestions.length} suggested fix{suggestions.length === 1 ? '' : 'es'}</b>
        <span className="sg-hint">deterministic · review before applying</span>
        <div className="sg-spacer" />
        <button
          className="sg-all"
          onClick={(e) => {
            e.stopPropagation()
            applyAll()
          }}
        >
          <Check size={13} /> Fix all
        </button>
      </div>
      {!collapsed && (
        <div className="suggest-chips">
          <AnimatePresence mode="popLayout">
            {suggestions.map((s) => {
              const Icon = ICONS[s.icon] ?? Wand2
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="sg-chip"
                >
                  <div className="sg-ic">
                    <Icon size={14} />
                  </div>
                  <div className="sg-text">
                    <div className="sg-title">{s.title}</div>
                    <div className="sg-detail">{s.detail}</div>
                  </div>
                  <button className="sg-apply" onClick={() => applyOne(s)}>
                    Apply
                  </button>
                  <button
                    className="sg-x"
                    title="Dismiss"
                    onClick={() => setDismissed((d) => new Set(d).add(s.id))}
                  >
                    <X size={12} />
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
      <style>{css}</style>
    </motion.div>
  )
}

const css = `
.suggest-bar { border-radius: 16px; margin-bottom: 12px; padding: 11px 14px; }
.suggest-head { display: flex; align-items: center; gap: 9px; cursor: default; }
.suggest-head b { font-size: 13px; }
.sg-spark { color: var(--accent); }
.sg-hint { font-size: 11px; color: var(--text-3); }
.sg-spacer { flex: 1; }
.sg-all {
  display: flex; align-items: center; gap: 5px; border: none; cursor: default;
  background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
  font-family: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 9px;
  box-shadow: 0 4px 12px var(--accent-glow);
}
.sg-all:hover { filter: brightness(1.06); }
.suggest-chips { display: flex; gap: 9px; margin-top: 11px; flex-wrap: wrap; }
.sg-chip {
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 10px;
  background: var(--glass-bg-strong); border: 1px solid var(--glass-brd-2); border-radius: 12px;
}
.sg-ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: var(--accent); background: var(--active); flex-shrink: 0; }
.sg-text { min-width: 0; }
.sg-title { font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.sg-detail { font-size: 11px; color: var(--text-3); white-space: nowrap; }
.sg-apply {
  border: none; cursor: default; font-family: inherit; font-size: 12px; font-weight: 600;
  color: var(--accent); background: var(--active); padding: 6px 12px; border-radius: 8px;
}
.sg-apply:hover { background: var(--accent); color: #fff; }
.sg-x { border: none; background: transparent; color: var(--text-3); cursor: default; padding: 4px; border-radius: 6px; display: grid; place-items: center; }
.sg-x:hover { background: var(--hover); color: var(--danger); }
`
