import { useState } from 'react'
import { Table } from '../../engine/types'
import { clustersFor } from '../../engine/pipeline'
import { Cluster, ClusterMethod } from '../../engine/algorithms'
import { useStore } from '../../state/store'
import { Button, Field, Segmented } from '../ui'
import { Boxes, Merge } from 'lucide-react'

export function ClusterTool({ table, column }: { table: Table; column: string }) {
  const addOp = useStore((s) => s.addOp)
  const [method, setMethod] = useState<ClusterMethod>('fingerprint')
  const [threshold, setThreshold] = useState(0.85)
  const [clusters, setClusters] = useState<Cluster[] | null>(null)
  const [picks, setPicks] = useState<Record<string, { on: boolean; canonical: string }>>({})

  function find() {
    const cs = clustersFor(table, column, method, threshold)
    setClusters(cs)
    const p: Record<string, { on: boolean; canonical: string }> = {}
    cs.forEach((c) => (p[c.key] = { on: true, canonical: c.suggestion }))
    setPicks(p)
  }

  function merge() {
    if (!clusters) return
    const mapping: Record<string, string> = {}
    let count = 0
    for (const c of clusters) {
      const pick = picks[c.key]
      if (!pick?.on) continue
      count++
      for (const v of c.values) mapping[v.value] = pick.canonical
    }
    if (count === 0) return
    addOp('clusterMerge', `Merge ${count} cluster${count === 1 ? '' : 's'} in “${column}”`, {
      column,
      mapping
    })
    setClusters(null)
  }

  const activeCount = clusters?.filter((c) => picks[c.key]?.on).length ?? 0

  return (
    <div>
      <div className="isec" style={{ borderTop: 'none', paddingTop: 6 }}>
        <div className="tool-lead">
          <Boxes size={15} />
          <div>
            <div className="tool-lead-t">Cluster similar values</div>
            <div className="tool-lead-s">Group typos and variants in “{column}”, then merge to one canonical value.</div>
          </div>
        </div>

        <Field label="Matching method">
          <Segmented
            value={method}
            onChange={(m) => setMethod(m as ClusterMethod)}
            options={[
              { value: 'fingerprint', label: 'Fingerprint' },
              { value: 'ngram', label: 'N-gram' },
              { value: 'levenshtein', label: 'Nearest' }
            ]}
          />
        </Field>

        {method === 'levenshtein' && (
          <Field label={`Similarity threshold — ${(threshold * 100).toFixed(0)}%`}>
            <input
              className="slider"
              type="range"
              min={0.6}
              max={0.98}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
            />
          </Field>
        )}

        <Button variant="primary" onClick={find} style={{ width: '100%', justifyContent: 'center' }}>
          Find clusters
        </Button>
      </div>

      {clusters && (
        <div className="isec">
          {clusters.length === 0 && <div className="muted-note">No clusters found. The values look consistent already.</div>}
          {clusters.map((c) => {
            const pick = picks[c.key]
            return (
              <div className={'cluster' + (pick?.on ? '' : ' off')} key={c.key}>
                <div className="cluster-head">
                  <input
                    type="checkbox"
                    checked={pick?.on ?? false}
                    onChange={(e) => setPicks((p) => ({ ...p, [c.key]: { ...p[c.key], on: e.target.checked } }))}
                  />
                  <input
                    className="inp canonical"
                    value={pick?.canonical ?? ''}
                    onChange={(e) => setPicks((p) => ({ ...p, [c.key]: { ...p[c.key], canonical: e.target.value } }))}
                  />
                  <span className="cluster-total">{c.total}</span>
                </div>
                <div className="cluster-vals">
                  {c.values.map((v) => (
                    <span key={v.value} className="cluster-chip">
                      {v.value} <b>{v.count}</b>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
          {clusters.length > 0 && (
            <Button
              variant="primary"
              onClick={merge}
              disabled={activeCount === 0}
              style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
            >
              <Merge size={14} /> Merge {activeCount} cluster{activeCount === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}
      <style>{css}</style>
    </div>
  )
}

const css = `
.tool-lead { display: flex; gap: 10px; margin-bottom: 14px; }
.tool-lead svg { color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.tool-lead-t { font-weight: 640; font-size: 13px; }
.tool-lead-s { font-size: 11.5px; color: var(--text-2); line-height: 1.45; margin-top: 2px; }
.slider { width: 100%; accent-color: var(--accent); }
.muted-note { font-size: 12px; color: var(--text-3); text-align: center; padding: 18px; }
.cluster { border: 1px solid var(--hairline); border-radius: 12px; padding: 9px; margin-bottom: 8px; background: var(--hover); transition: opacity 0.14s; }
.cluster.off { opacity: 0.5; }
.cluster-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.cluster-head input[type=checkbox] { accent-color: var(--accent); }
.canonical { flex: 1; font-weight: 600; }
.cluster-total { font-size: 11px; color: var(--text-2); font-weight: 700; font-variant-numeric: tabular-nums; }
.cluster-vals { display: flex; flex-wrap: wrap; gap: 4px; }
.cluster-chip { font-size: 11px; background: var(--glass-bg-strong); border: 1px solid var(--hairline); padding: 2px 7px; border-radius: 6px; color: var(--text-2); }
.cluster-chip b { color: var(--accent); font-variant-numeric: tabular-nums; }
`
