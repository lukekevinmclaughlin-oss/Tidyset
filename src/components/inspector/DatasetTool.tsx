import { useMemo, useState } from 'react'
import { Table } from '../../engine/types'
import { datasetStats } from '../../engine/pipeline'
import { datasetQuality } from '../../engine/quality'
import { useStore } from '../../state/store'
import { Button, Field, Select, TextInput } from '../ui'
import { Rows3, Columns3, CopyMinus, Combine, Fingerprint, Replace, Regex } from 'lucide-react'

function ColumnPicker({
  columns,
  selected,
  onToggle
}: {
  columns: string[]
  selected: Set<string>
  onToggle: (c: string) => void
}) {
  return (
    <div className="picker">
      {columns.map((c) => (
        <button key={c} className={'pick' + (selected.has(c) ? ' on' : '')} onClick={() => onToggle(c)}>
          {c}
        </button>
      ))}
    </div>
  )
}

export function DatasetTool({ table }: { table: Table }) {
  const addOp = useStore((s) => s.addOp)
  const stats = useMemo(() => datasetStats(table), [table])
  const quality = useMemo(() => datasetQuality(table), [table])
  const cols = table.columns.map((c) => c.name)

  const [mergeSel, setMergeSel] = useState<Set<string>>(new Set())
  const [mergeName, setMergeName] = useState('merged')
  const [mergeSep, setMergeSep] = useState(' ')
  const [dedupeSel, setDedupeSel] = useState<Set<string>>(new Set())
  const [threshold, setThreshold] = useState(0.9)
  const [survivor, setSurvivor] = useState('first')
  const [gFind, setGFind] = useState('')
  const [gRepl, setGRepl] = useState('')
  const [gRegex, setGRegex] = useState(false)

  const scoreColor = quality.score >= 85 ? 'var(--good)' : quality.score >= 60 ? 'var(--warn)' : 'var(--danger)'
  const ringDash = 2 * Math.PI * 26
  const issueCols = quality.columns.filter((c) => c.issues.length > 0)

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, c: string) => {
    const n = new Set(set)
    n.has(c) ? n.delete(c) : n.add(c)
    setter(n)
  }

  const emptyPct = stats.totalCells ? ((stats.emptyCells / stats.totalCells) * 100).toFixed(1) : '0'

  return (
    <div>
      <div className="isec" style={{ borderTop: 'none', paddingTop: 6 }}>
        <div className="health">
          <div className="ring-wrap">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" fill="none" stroke="var(--hairline)" strokeWidth="7" />
              <circle
                cx="32"
                cy="32"
                r="26"
                fill="none"
                stroke={scoreColor}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={ringDash}
                strokeDashoffset={ringDash * (1 - quality.score / 100)}
                transform="rotate(-90 32 32)"
                style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s' }}
              />
            </svg>
            <div className="ring-score" style={{ color: scoreColor }}>
              {quality.score}
            </div>
          </div>
          <div className="health-meta">
            <div className="health-title">Data quality</div>
            <div className="health-sub">
              {Math.round(quality.completeness * 100)}% complete · {quality.duplicateRows} duplicate row
              {quality.duplicateRows === 1 ? '' : 's'} · {issueCols.length} column
              {issueCols.length === 1 ? '' : 's'} with issues
            </div>
          </div>
        </div>
        {issueCols.length > 0 && (
          <div className="issue-list">
            {issueCols.map((c) => (
              <div className="issue" key={c.name}>
                <span className="issue-name">{c.name}</span>
                <span className="issue-tags">{c.issues.join(' · ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="isec">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-n">{stats.rows.toLocaleString()}</div>
            <div className="stat-l">Rows</div>
          </div>
          <div className="stat">
            <div className="stat-n">{stats.cols}</div>
            <div className="stat-l">Columns</div>
          </div>
          <div className="stat">
            <div className="stat-n">{emptyPct}%</div>
            <div className="stat-l">Empty cells</div>
          </div>
        </div>
      </div>

      <div className="isec">
        <div className="isec-title">Quick clean-up</div>
        <div className="chip-grid">
          <Button variant="solid" onClick={() => addOp('removeEmptyRows', 'Remove empty rows', {})}>
            <Rows3 size={13} /> Empty rows
          </Button>
          <Button variant="solid" onClick={() => addOp('removeEmptyColumns', 'Remove empty columns', {})}>
            <Columns3 size={13} /> Empty columns
          </Button>
          <Button
            variant="solid"
            onClick={() => addOp('dedupeRows', 'Remove duplicate rows', {})}
            style={{ gridColumn: '1 / -1' }}
          >
            <CopyMinus size={13} /> Remove exact duplicate rows
          </Button>
        </div>
      </div>

      <div className="isec">
        <div className="isec-title">Find &amp; replace — all columns</div>
        <div className="grid2">
          <Field label="Find">
            <TextInput value={gFind} onChange={setGFind} placeholder="text or /regex/" />
          </Field>
          <Field label="Replace with">
            <TextInput value={gRepl} onChange={setGRepl} placeholder="" />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={gRegex} onChange={(e) => setGRegex(e.target.checked)} />
          <Regex size={13} /> Regular expression
        </label>
        <Button
          variant="solid"
          disabled={!gFind}
          onClick={() =>
            addOp('replace', `Replace “${gFind}” across all columns`, {
              columns: cols,
              find: gFind,
              replaceWith: gRepl,
              regex: gRegex
            })
          }
        >
          <Replace size={13} /> Replace in all columns
        </Button>
      </div>

      <div className="isec">
        <div className="isec-title">Merge columns</div>
        <ColumnPicker columns={cols} selected={mergeSel} onToggle={(c) => toggle(mergeSel, setMergeSel, c)} />
        <div className="grid2" style={{ marginTop: 8 }}>
          <Field label="Separator">
            <input className="inp" value={mergeSep} onChange={(e) => setMergeSep(e.target.value)} />
          </Field>
          <Field label="New name">
            <input className="inp" value={mergeName} onChange={(e) => setMergeName(e.target.value)} />
          </Field>
        </div>
        <Button
          variant="solid"
          disabled={mergeSel.size < 2}
          onClick={() =>
            addOp('mergeColumns', `Merge ${mergeSel.size} columns → “${mergeName}”`, {
              columns: [...mergeSel],
              separator: mergeSep,
              name: mergeName
            })
          }
        >
          <Combine size={13} /> Merge {mergeSel.size} columns
        </Button>
      </div>

      <div className="isec">
        <div className="isec-title">Fuzzy de-duplicate</div>
        <div className="tool-lead-s" style={{ marginBottom: 10 }}>
          Collapse near-identical records (typos, spacing). Pick the key columns to compare.
        </div>
        <ColumnPicker columns={cols} selected={dedupeSel} onToggle={(c) => toggle(dedupeSel, setDedupeSel, c)} />
        <Field label={`Similarity — ${(threshold * 100).toFixed(0)}%`}>
          <input
            className="slider"
            type="range"
            min={0.7}
            max={0.99}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
          />
        </Field>
        <Field label="Keep which record">
          <Select
            value={survivor}
            onChange={setSurvivor}
            options={[
              { value: 'first', label: 'First seen' },
              { value: 'longest', label: 'Longest value' },
              { value: 'mostComplete', label: 'Most complete row' }
            ]}
          />
        </Field>
        <Button
          variant="solid"
          disabled={dedupeSel.size === 0}
          onClick={() =>
            addOp('fuzzyDedupe', `Fuzzy de-dupe on ${dedupeSel.size} column${dedupeSel.size === 1 ? '' : 's'}`, {
              columns: [...dedupeSel],
              threshold,
              survivorship: survivor
            })
          }
        >
          <Fingerprint size={13} /> De-duplicate
        </Button>
      </div>
      <style>{css}</style>
    </div>
  )
}

const css = `
.stat-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
.stat { background: var(--hover); border-radius: 12px; padding: 12px 8px; text-align: center; }
.stat-n { font-size: 19px; font-weight: 720; letter-spacing: -0.02em; background: linear-gradient(135deg,var(--accent),var(--accent-2)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.stat-l { font-size: 10.5px; color: var(--text-3); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; }
.picker { display: flex; flex-wrap: wrap; gap: 5px; }
.pick { font-size: 11.5px; background: var(--hover); border: 1px solid var(--hairline); color: var(--text-2); padding: 4px 9px; border-radius: 8px; cursor: default; transition: all 0.12s; }
.pick.on { background: var(--active); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.health { display: flex; align-items: center; gap: 14px; }
.ring-wrap { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
.ring-score { position: absolute; inset: 0; display: grid; place-items: center; font-size: 20px; font-weight: 760; letter-spacing: -0.02em; }
.health-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.health-sub { font-size: 11.5px; color: var(--text-2); line-height: 1.5; margin-top: 3px; }
.issue-list { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
.issue { display: flex; align-items: baseline; gap: 8px; padding: 6px 9px; background: var(--hover); border-radius: 9px; }
.issue-name { font-size: 12px; font-weight: 620; flex-shrink: 0; }
.issue-tags { font-size: 11px; color: var(--warn); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); margin: 4px 0 10px; cursor: default; }
.check input { accent-color: var(--accent); }
`
