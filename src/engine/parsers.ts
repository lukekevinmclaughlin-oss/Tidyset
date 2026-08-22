// Deterministic structured parsers (dates handled in dataframe.ts).
import { CellValue } from './types'

/** Normalise a phone number toward E.164-ish form. Deterministic. */
export function normalizePhone(raw: string, defaultCountry = '1'): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (hasPlus) return '+' + digits
  // handle common trunk prefixes
  if (digits.startsWith('00')) return '+' + digits.slice(2)
  if (defaultCountry === '1' && digits.length === 10) return '+1' + digits
  if (defaultCountry === '1' && digits.length === 11 && digits.startsWith('1')) return '+' + digits
  if (digits.startsWith('0')) digits = digits.slice(1)
  return '+' + defaultCountry + digits
}

/** Split a full name into components (best-effort, rule based). */
export function parseName(raw: string): { first: string; last: string } {
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return { first: '', last: '' }
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim())
    return { first: first ?? '', last: last ?? '' }
  }
  const parts = s.split(' ')
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

export type ParseKind = 'phone' | 'name'

export function applyParse(value: CellValue, kind: ParseKind, opts: Record<string, any>): CellValue {
  if (value === null) return null
  const s = String(value)
  if (kind === 'phone') return normalizePhone(s, opts.country ?? '1')
  if (kind === 'name') {
    const { first, last } = parseName(s)
    return opts.part === 'last' ? last : first
  }
  return value
}
