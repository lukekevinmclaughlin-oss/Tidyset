import { useMemo, useState } from 'react'
import { CellValue, Table } from '../../engine/types'
import { checkExpression, compileExpression } from '../../engine/expression'
import { useStore } from '../../state/store'
import { Button, Field, Segmented, Select } from '../ui'
import { FunctionSquare } from 'lucide-react'

const EXAMPLES = [
  'upper(trim(value))',
  'concat($First, " ", $Last)',
  'part(value, "@", 1)',
  'if(len(value) > 5, "long", "short")',
  'coalesce($Nickname, $First, "N/A")',
  'round(number(value) * 1.2, 2)'
]

const FUNCS =
  'upper lower trim title len replace regexReplace substr concat split part contains startsWith endsWith coalesce number str round abs if'

export function FormulaTool({ table, column }: { table: Table; column: string }) {
  const addOp = useStore((s) => s.addOp)
  const [expr, setExpr] = useState('upper(trim(value))')
  const [mode, setMode] = useState<'new' | 'replace'>('new')
  const [name, setName] = useState('new_column')
  const [target, setTarget] = useState(column)

  const err = useMemo(() => checkExpression(expr), [expr])

  const preview = useMemo(() => {
    if (err) return []
    try {
      const fn = compileExpression(expr)
      const out: { before: CellValue; after: CellValue }[] = []
      const rows = Math.min(6, table.nrows)
      const tgt = mode === 'replace' ? table.columns.find((c) => c.name === target) : null
      for (let i = 0; i < rows; i++) {
        const rowObj: Record<string, CellValue> = {}
        for (const c of table.columns) rowObj[c.name] = c.values[i]
        const cur = tgt ? tgt.values[i] : null
        out.push({ before: cur, after: fn.eval({ value: cur, row: rowObj }) })
      }
      return out
    } catch {
      return []
    }
  }, [expr, err, mode, target, table])

  return (
    <div>
      <div className="isec" style={{ borderTop: 'none', paddingTop: 6 }}>
        <div className="tool-lead">
          <FunctionSquare size={15} />
          <div>
            <div className="tool-lead-t">Formula</div>
            <div className="tool-lead-s">
              Use <code>value</code> for the current cell and <code>$Column</code> for others.
            </div>
          </div>
        </div>

        <Field label="Expression">
          <textarea className="inp" rows={3} value={expr} onChange={(e) => setExpr(e.target.value)} spellCheck={false} />
        </Field>
        {err && <div className="expr-err">{err}</div>}

        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="ex-chip" onClick={() => setExpr(ex)}>
              {ex}
            </button>
          ))}
        </div>

        <div className="grid2" style={{ marginTop: 10 }}>
          <Field label="Output">
            <Segmented
              value={mode}
              onChange={(m) => setMode(m as 'new' | 'replace')}
              options={[
                { value: 'new', label: 'New column' },
                { value: 'replace', label: 'Replace' }
              ]}
            />
          </Field>
          {mode === 'new' ? (
            <Field label="New column name">
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : (
            <Field label="Replace column">
              <Select
                value={target}
                onChange={setTarget}
                options={table.columns.map((c) => ({ value: c.name, label: c.name }))}
              />
            </Field>
          )}
        </div>
      </div>

      {preview.length > 0 && (
        <div className="isec">
          <div className="isec-title">Preview</div>
          <div className="preview">
            {preview.map((p, i) => (
              <div className="prow" key={i}>
                <span className="pbefore">{p.before === null ? '—' : String(p.before)}</span>
                <span className="parrow">→</span>
                <span className="pafter">{p.after === null ? '—' : String(p.after)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="isec">
        <Button
          variant="primary"
          disabled={!!err}
          onClick={() =>
            addOp('expression', mode === 'new' ? `Compute “${name}”` : `Transform “${target}”`, {
              expr,
              mode,
              name,
              target
            })
          }
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Add formula step
        </Button>
        <div className="fn-ref">
          <b>Functions</b> {FUNCS}
        </div>
      </div>
      <style>{css}</style>
    </div>
  )
}

const css = `
.tool-lead-s code { font-family: var(--mono); background: var(--hover); padding: 1px 4px; border-radius: 4px; font-size: 11px; }
.expr-err { color: var(--danger); font-size: 11.5px; margin: -4px 0 8px; font-family: var(--mono); }
.examples { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.ex-chip { font-family: var(--mono); font-size: 10.5px; background: var(--hover); border: 1px solid var(--hairline); color: var(--text-2); padding: 3px 7px; border-radius: 6px; cursor: default; }
.ex-chip:hover { background: var(--active); color: var(--accent); }
.preview { display: flex; flex-direction: column; gap: 4px; }
.prow { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.pbefore { flex: 1; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-family: var(--mono); }
.parrow { color: var(--accent); }
.pafter { flex: 1; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-weight: 600; }
.fn-ref { font-size: 10.5px; color: var(--text-3); margin-top: 10px; line-height: 1.6; font-family: var(--mono); }
.fn-ref b { color: var(--text-2); font-family: var(--font); }
`
