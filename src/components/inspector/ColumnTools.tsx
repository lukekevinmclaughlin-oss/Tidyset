import React, { useMemo, useState } from 'react'
import { Table } from '../../engine/types'
import { facet } from '../../engine/pipeline'
import { columnProfile } from '../../engine/stats'
import { useStore } from '../../state/store'
import { Button, Field, Segmented, Select, TextInput } from '../ui'
import {
  CaseSensitive,
  Eraser,
  Calendar,
  Trash2,
  Scissors,
  Regex,
  Replace,
  Filter,
  Wand2,
  Type,
  MoveLeft,
  MoveRight,
  BarChart3
} from 'lucide-react'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="isec">
      <div className="isec-title">{title}</div>
      {children}
    </div>
  )
}

export function ColumnTools({ table, column }: { table: Table; column: string }) {
  const addOp = useStore((s) => s.addOp)
  const col = table.columns.find((c) => c.name === column)
  const { values: facetValues, blank } = useMemo(() => facet(table, column, 8), [table, column])
  const profile = useMemo(() => columnProfile(table, column), [table, column])
  const colIndex = table.columns.findIndex((c) => c.name === column)

  const [rename, setRename] = useState('')
  const [splitDelim, setSplitDelim] = useState(',')
  const [extractPat, setExtractPat] = useState('')
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [useRe, setUseRe] = useState(false)
  const [fillStrat, setFillStrat] = useState('down')
  const [fillConst, setFillConst] = useState('')
  const [filterOp, setFilterOp] = useState('contains')
  const [filterVal, setFilterVal] = useState('')
  const [scope, setScope] = useState<'this' | 'allText'>('this')

  if (!col) return null
  const maxCount = facetValues[0]?.count ?? 1
  const textCols = table.columns.filter((c) => c.type === 'text').map((c) => c.name)
  const targets = scope === 'allText' ? textCols : [column]
  const scopeLabel = scope === 'allText' ? `${textCols.length} text columns` : `“${column}”`
  const fmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const histMax = profile?.histogram ? Math.max(...profile.histogram.bins, 1) : 1

  return (
    <div>
      <div className="col-hero">
        <div className="col-hero-name">
          <Type size={15} />
          <span>{column}</span>
          <span className={'badge ' + col.type}>{col.type}</span>
        </div>
      </div>

      {profile && (
        <Section title="Profile">
          <div className="prof-stats">
            <div>
              <b>{profile.filled.toLocaleString()}</b>
              <span>filled</span>
            </div>
            <div>
              <b>{profile.blank.toLocaleString()}</b>
              <span>blank</span>
            </div>
            <div>
              <b>{profile.distinct.toLocaleString()}</b>
              <span>distinct</span>
            </div>
          </div>
          {profile.histogram && (
            <div className="hist" title="Distribution">
              {profile.histogram.bins.map((n, i) => (
                <div
                  key={i}
                  className="hist-bar"
                  style={{ height: `${Math.max((n / histMax) * 100, n > 0 ? 6 : 0)}%` }}
                />
              ))}
            </div>
          )}
          {profile.numeric && (
            <div className="prof-nums">
              <span>min <b>{fmt(profile.numeric.min)}</b></span>
              <span>max <b>{fmt(profile.numeric.max)}</b></span>
              <span>mean <b>{fmt(profile.numeric.mean)}</b></span>
              <span>median <b>{fmt(profile.numeric.median)}</b></span>
              <span>sum <b>{fmt(profile.numeric.sum)}</b></span>
              <span>std <b>{fmt(profile.numeric.std)}</b></span>
            </div>
          )}
          {profile.text && (
            <div className="prof-nums">
              <span>min length <b>{profile.text.minLen}</b></span>
              <span>max length <b>{profile.text.maxLen}</b></span>
              <span>avg length <b>{profile.text.avgLen.toFixed(1)}</b></span>
            </div>
          )}
          {profile.date && (
            <div className="prof-nums">
              <span>from <b>{profile.date.min}</b></span>
              <span>to <b>{profile.date.max}</b></span>
            </div>
          )}
        </Section>
      )}

      <Section title="Type & name">
        <div className="grid2">
          <Field label="Column type">
            <Select
              value={col.type}
              onChange={(v) => addOp('changeType', `Set “${column}” to ${v}`, { column, type: v })}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'integer', label: 'Integer' },
                { value: 'decimal', label: 'Decimal' },
                { value: 'date', label: 'Date' },
                { value: 'boolean', label: 'Boolean' }
              ]}
            />
          </Field>
          <Field label="Rename to">
            <div className="row-inline">
              <TextInput value={rename} onChange={setRename} placeholder={column} />
              <Button
                variant="solid"
                disabled={!rename.trim()}
                onClick={() => {
                  addOp('renameColumn', `Rename “${column}” → “${rename}”`, { column, name: rename })
                  setRename('')
                }}
              >
                Set
              </Button>
            </div>
          </Field>
        </div>
        <div className="move-row">
          <Button
            variant="solid"
            disabled={colIndex <= 0}
            onClick={() => addOp('moveColumn', `Move “${column}” left`, { column, dir: -1 })}
          >
            <MoveLeft size={13} /> Move left
          </Button>
          <Button
            variant="solid"
            disabled={colIndex >= table.columns.length - 1}
            onClick={() => addOp('moveColumn', `Move “${column}” right`, { column, dir: 1 })}
          >
            Move right <MoveRight size={13} />
          </Button>
        </div>
      </Section>

      <Section title="Clean text">
        <div style={{ marginBottom: 10 }}>
          <Segmented
            value={scope}
            onChange={(v) => setScope(v as 'this' | 'allText')}
            options={[
              { value: 'this', label: 'This column' },
              { value: 'allText', label: `All text (${textCols.length})` }
            ]}
          />
        </div>
        <div className="chip-grid">
          <Button variant="solid" onClick={() => addOp('trim', `Trim ${scopeLabel}`, { columns: targets })}>
            <Eraser size={13} /> Trim spaces
          </Button>
          <Button
            variant="solid"
            onClick={() => addOp('changeCase', `lowercase ${scopeLabel}`, { columns: targets, mode: 'lower' })}
          >
            <CaseSensitive size={13} /> lower
          </Button>
          <Button
            variant="solid"
            onClick={() => addOp('changeCase', `UPPERCASE ${scopeLabel}`, { columns: targets, mode: 'upper' })}
          >
            <CaseSensitive size={13} /> UPPER
          </Button>
          <Button
            variant="solid"
            onClick={() => addOp('changeCase', `Title Case ${scopeLabel}`, { columns: targets, mode: 'title' })}
          >
            <CaseSensitive size={13} /> Title
          </Button>
          <Button
            variant="solid"
            onClick={() => addOp('standardizeDate', `Standardise dates “${column}”`, { column })}
          >
            <Calendar size={13} /> Dates → ISO
          </Button>
          <Button
            variant="solid"
            onClick={() => addOp('parseField', `Normalise phones “${column}”`, { column, kind: 'phone' })}
          >
            <Wand2 size={13} /> Phones
          </Button>
        </div>
      </Section>

      <Section title="Find & replace">
        <div className="grid2">
          <Field label="Find">
            <TextInput value={find} onChange={setFind} placeholder="text or /regex/" />
          </Field>
          <Field label="Replace with">
            <TextInput value={repl} onChange={setRepl} placeholder="" />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={useRe} onChange={(e) => setUseRe(e.target.checked)} />
          <Regex size={13} /> Regular expression
        </label>
        <Button
          variant="solid"
          disabled={!find}
          onClick={() =>
            addOp('replace', `Replace in “${column}”`, {
              columns: [column],
              find,
              replaceWith: repl,
              regex: useRe
            })
          }
        >
          <Replace size={13} /> Replace all
        </Button>
      </Section>

      <Section title="Fill missing values">
        <div className="grid2">
          <Field label="Strategy">
            <Select
              value={fillStrat}
              onChange={setFillStrat}
              options={[
                { value: 'down', label: 'Fill down' },
                { value: 'up', label: 'Fill up' },
                { value: 'constant', label: 'Constant' },
                { value: 'mean', label: 'Mean' },
                { value: 'median', label: 'Median' },
                { value: 'mode', label: 'Most frequent' }
              ]}
            />
          </Field>
          {fillStrat === 'constant' && (
            <Field label="Value">
              <TextInput value={fillConst} onChange={setFillConst} />
            </Field>
          )}
        </div>
        <Button
          variant="solid"
          onClick={() =>
            addOp('fillMissing', `Fill missing “${column}” (${fillStrat})`, {
              column,
              strategy: fillStrat,
              value: fillConst
            })
          }
        >
          Fill {blank} blank{blank === 1 ? '' : 's'}
        </Button>
      </Section>

      <Section title="Split & extract">
        <div className="row-inline">
          <TextInput value={splitDelim} onChange={setSplitDelim} placeholder="delimiter" />
          <Button
            variant="solid"
            onClick={() => addOp('splitColumn', `Split “${column}” by “${splitDelim}”`, { column, delimiter: splitDelim })}
          >
            <Scissors size={13} /> Split
          </Button>
        </div>
        <div className="row-inline" style={{ marginTop: 8 }}>
          <TextInput value={extractPat} onChange={setExtractPat} placeholder="regex e.g. (\\d+)" mono />
          <Button
            variant="solid"
            disabled={!extractPat}
            onClick={() => addOp('extract', `Extract from “${column}”`, { column, pattern: extractPat })}
          >
            Extract
          </Button>
        </div>
      </Section>

      <Section title="Filter rows">
        <div className="grid2">
          <Field label="Keep rows where">
            <Select
              value={filterOp}
              onChange={setFilterOp}
              options={[
                { value: 'contains', label: 'contains' },
                { value: 'notContains', label: 'does not contain' },
                { value: 'eq', label: 'equals' },
                { value: 'neq', label: 'not equal' },
                { value: 'gt', label: '> greater than' },
                { value: 'lt', label: '< less than' },
                { value: 'gte', label: '≥ at least' },
                { value: 'lte', label: '≤ at most' },
                { value: 'empty', label: 'is empty' },
                { value: 'notEmpty', label: 'is not empty' }
              ]}
            />
          </Field>
          <Field label="Value">
            <TextInput value={filterVal} onChange={setFilterVal} />
          </Field>
        </div>
        <Button
          variant="solid"
          onClick={() =>
            addOp('filterRows', `Filter “${column}” ${filterOp} ${filterVal}`, {
              column,
              op: filterOp,
              value: filterVal
            })
          }
        >
          <Filter size={13} /> Apply filter
        </Button>
      </Section>

      <Section title={`Values (${facetValues.length})`}>
        <div className="facet">
          {facetValues.map((f) => (
            <div className="facet-row" key={f.value}>
              <div className="facet-bar" style={{ width: `${(f.count / maxCount) * 100}%` }} />
              <span className="facet-val" title={f.value}>
                {f.value}
              </span>
              <span className="facet-count">{f.count}</span>
            </div>
          ))}
          {blank > 0 && (
            <div className="facet-row">
              <div className="facet-bar warn" style={{ width: `${(blank / maxCount) * 100}%` }} />
              <span className="facet-val muted">(blank)</span>
              <span className="facet-count">{blank}</span>
            </div>
          )}
        </div>
      </Section>

      <Section title="Danger zone">
        <Button
          variant="solid"
          className="danger-btn"
          onClick={() => addOp('deleteColumns', `Delete column “${column}”`, { columns: [column] })}
        >
          <Trash2 size={13} /> Delete this column
        </Button>
      </Section>

      <style>{css}</style>
    </div>
  )
}

const css = `
.col-hero { padding: 4px 2px 14px; }
.col-hero-name { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 680; letter-spacing: -0.01em; }
.col-hero-name svg { color: var(--accent); }
.prof-stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 10px; }
.prof-stats > div { background: var(--hover); border-radius: 10px; padding: 9px 6px; text-align: center; }
.prof-stats b { display: block; font-size: 16px; font-weight: 720; letter-spacing: -0.01em; }
.prof-stats span { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.03em; }
.hist { display: flex; align-items: flex-end; gap: 2px; height: 44px; padding: 4px 2px; background: var(--hover); border-radius: 10px; margin-bottom: 10px; }
.hist-bar { flex: 1; background: linear-gradient(180deg, var(--accent), var(--accent-2)); border-radius: 2px 2px 0 0; min-height: 0; transition: height 0.3s ease; }
.prof-nums { display: flex; flex-wrap: wrap; gap: 5px 10px; }
.prof-nums span { font-size: 11px; color: var(--text-3); }
.prof-nums b { color: var(--text-1); font-variant-numeric: tabular-nums; }
.move-row { display: flex; gap: 6px; margin-top: 10px; }
.move-row .btn { flex: 1; justify-content: center; }
.isec { padding: 13px 2px; border-top: 1px solid var(--hairline); }
.isec-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); margin-bottom: 10px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.chip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.chip-grid .btn { justify-content: flex-start; }
.row-inline { display: flex; gap: 6px; align-items: stretch; }
.row-inline > .inp { flex: 1; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); margin: 4px 0 10px; cursor: default; }
.check input { accent-color: var(--accent); }
.danger-btn { color: var(--danger); width: 100%; justify-content: center; }
.danger-btn:hover { background: rgba(255,93,93,0.12); }
.facet { display: flex; flex-direction: column; gap: 3px; }
.facet-row { position: relative; display: flex; align-items: center; height: 24px; border-radius: 7px; padding: 0 9px; overflow: hidden; }
.facet-bar { position: absolute; left: 0; top: 0; bottom: 0; background: var(--active); border-radius: 7px; }
.facet-bar.warn { background: rgba(245,165,36,0.2); }
.facet-val { position: relative; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.facet-val.muted { color: var(--text-3); font-style: italic; }
.facet-count { position: relative; font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; font-weight: 600; }
`
