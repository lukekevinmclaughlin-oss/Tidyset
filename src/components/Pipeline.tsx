import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../state/store'
import { StepDelta } from '../engine/pipeline'
import { Eye, EyeOff, ChevronUp, ChevronDown, X, Layers, Sparkles } from 'lucide-react'

function DeltaBadge({ d }: { d: StepDelta }) {
  if (d.rows < 0) return <span className="delta neg">{d.rows} rows</span>
  if (d.rows > 0) return <span className="delta pos">+{d.rows} rows</span>
  if (d.addedCols) return <span className="delta pos">+{d.addedCols} col</span>
  if (d.removedCols) return <span className="delta neg">−{d.removedCols} col</span>
  if (d.cells) return <span className="delta neutral">{d.cells} cell{d.cells === 1 ? '' : 's'}</span>
  return null
}

export function Pipeline({ deltas }: { deltas: (StepDelta | null)[] }) {
  const ops = useStore((s) => s.ops)
  const selectedOpId = useStore((s) => s.selectedOpId)
  const selectOp = useStore((s) => s.selectOp)
  const toggleOp = useStore((s) => s.toggleOp)
  const moveOp = useStore((s) => s.moveOp)
  const removeOp = useStore((s) => s.removeOp)

  return (
    <div className="pane left glass">
      <div className="pane-head">
        <Layers size={14} /> Recipe
        <span className="count">{ops.length} steps</span>
      </div>
      <div className="pane-scroll" style={{ padding: 8 }}>
        {ops.length === 0 && (
          <div className="empty-recipe">
            <Sparkles size={26} strokeWidth={1.4} />
            <p>Every cleaning action is recorded here as a reversible step.</p>
            <p className="sub">Save the recipe and re-run it on next month's file.</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {ops.map((op, i) => (
            <motion.div
              key={op.id}
              layout
              initial={{ opacity: 0, x: -12, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 'auto' }}
              exit={{ opacity: 0, x: -12, height: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              className={'step' + (selectedOpId === op.id ? ' sel' : '') + (op.enabled ? '' : ' off')}
              onClick={() => selectOp(op.id === selectedOpId ? null : op.id)}
            >
              <div className="idx">{i + 1}</div>
              <div className="step-main">
                <div className="lbl">{op.label}</div>
                {deltas[i] && (
                  <div className="delta-wrap">
                    <DeltaBadge d={deltas[i]!} />
                  </div>
                )}
              </div>
              <div className="ops" onClick={(e) => e.stopPropagation()}>
                <button className="mini" title="Move up" onClick={() => moveOp(op.id, -1)}>
                  <ChevronUp size={13} />
                </button>
                <button className="mini" title="Move down" onClick={() => moveOp(op.id, 1)}>
                  <ChevronDown size={13} />
                </button>
                <button className="mini" title="Toggle" onClick={() => toggleOp(op.id)}>
                  {op.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button className="mini danger" title="Remove" onClick={() => removeOp(op.id)}>
                  <X size={13} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <style>{css}</style>
    </div>
  )
}

const css = `
.empty-recipe { text-align: center; color: var(--text-3); padding: 30px 18px; }
.empty-recipe svg { color: var(--accent); opacity: 0.75; margin-bottom: 10px; }
.empty-recipe p { font-size: 12px; line-height: 1.5; color: var(--text-2); }
.empty-recipe p.sub { font-size: 11px; color: var(--text-3); margin-top: 6px; }
.step {
  display: flex; align-items: center; gap: 9px; padding: 8px 9px;
  border-radius: 11px; margin-bottom: 4px; transition: background 0.14s;
  border: 1px solid transparent; overflow: hidden;
}
.step:hover { background: var(--hover); }
.step.sel { background: var(--active); border-color: rgba(47,124,246,0.3); }
.step.off { opacity: 0.45; }
.step .idx {
  width: 20px; height: 20px; border-radius: 6px; flex-shrink: 0;
  display: grid; place-items: center; font-size: 10.5px; font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
}
.step.off .idx { background: var(--text-3); }
.step-main { flex: 1; min-width: 0; }
.step .lbl { font-size: 12px; font-weight: 520; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.delta-wrap { margin-top: 2px; }
.delta { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 5px; letter-spacing: 0.02em; }
.delta.pos { background: rgba(34,192,125,0.16); color: var(--good); }
.delta.neg { background: rgba(255,93,93,0.14); color: var(--danger); }
.delta.neutral { background: rgba(47,124,246,0.14); color: var(--accent); }
.step .ops { display: flex; gap: 1px; opacity: 0; transition: opacity 0.14s; }
.step:hover .ops, .step.sel .ops { opacity: 1; }
.mini { border: none; background: transparent; color: var(--text-2); cursor: default; padding: 3px; border-radius: 6px; display: grid; place-items: center; }
.mini:hover { background: var(--glass-bg-strong); color: var(--text-1); }
.mini.danger:hover { color: var(--danger); }
`
