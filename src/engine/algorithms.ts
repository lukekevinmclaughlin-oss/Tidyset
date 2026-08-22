// Deterministic string algorithms powering clustering & fuzzy dedupe.
// No AI, no randomness — same input always yields the same output.

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/** Normalised similarity 0..1 based on edit distance. */
export function editSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

/** Jaro-Winkler similarity 0..1 — strong for names & short strings. */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const len1 = s1.length
  const len2 = s2.length
  if (len1 === 0 || len2 === 0) return 0
  const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1)
  const s1Matches = new Array(len1).fill(false)
  const s2Matches = new Array(len2).fill(false)
  let matches = 0
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, len2)
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue
      if (s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) t++
    k++
  }
  t /= 2
  const jaro = (matches / len1 + matches / len2 + (matches - t) / matches) / 3
  // Winkler boost for common prefix (up to 4 chars)
  let prefix = 0
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

/** OpenRefine-style key collision "fingerprint": lowercase, strip punctuation,
 *  split to tokens, dedupe, sort, join. */
export function fingerprint(s: string): string {
  return Array.from(
    new Set(
      s
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // strip diacritics
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    )
  )
    .sort()
    .join(' ')
}

/** n-gram fingerprint — catches more variants (typos, spacing). */
export function ngramFingerprint(s: string, n = 2): string {
  const clean = s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const grams = new Set<string>()
  for (let i = 0; i <= clean.length - n; i++) grams.add(clean.slice(i, i + n))
  return Array.from(grams).sort().join('')
}

export interface Cluster {
  key: string
  values: { value: string; count: number }[]
  suggestion: string
  total: number
}

export type ClusterMethod = 'fingerprint' | 'ngram' | 'levenshtein'

/** Group similar distinct values into clusters for review-and-merge. */
export function buildClusters(
  distinct: { value: string; count: number }[],
  method: ClusterMethod,
  threshold = 0.82
): Cluster[] {
  if (method === 'levenshtein') return buildNearestClusters(distinct, threshold)
  const keyFn = method === 'ngram' ? (s: string) => ngramFingerprint(s) : fingerprint
  const groups = new Map<string, { value: string; count: number }[]>()
  for (const d of distinct) {
    const k = keyFn(d.value)
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(d)
  }
  const clusters: Cluster[] = []
  for (const [key, members] of groups) {
    if (members.length < 2) continue
    clusters.push(makeCluster(key, members))
  }
  return clusters.sort((a, b) => b.total - a.total)
}

function buildNearestClusters(
  distinct: { value: string; count: number }[],
  threshold: number
): Cluster[] {
  const used = new Array(distinct.length).fill(false)
  const clusters: Cluster[] = []
  for (let i = 0; i < distinct.length; i++) {
    if (used[i]) continue
    const members = [distinct[i]]
    used[i] = true
    for (let j = i + 1; j < distinct.length; j++) {
      if (used[j]) continue
      const sim = jaroWinkler(distinct[i].value.toLowerCase(), distinct[j].value.toLowerCase())
      if (sim >= threshold) {
        members.push(distinct[j])
        used[j] = true
      }
    }
    if (members.length >= 2) clusters.push(makeCluster('nn_' + i, members))
  }
  return clusters.sort((a, b) => b.total - a.total)
}

function makeCluster(key: string, members: { value: string; count: number }[]): Cluster {
  const sorted = members.slice().sort((a, b) => b.count - a.count)
  return {
    key,
    values: sorted,
    suggestion: sorted[0].value, // most frequent value wins by default
    total: sorted.reduce((s, m) => s + m.count, 0)
  }
}
