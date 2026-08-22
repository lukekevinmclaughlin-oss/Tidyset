// A small, safe, deterministic expression language for custom transforms.
// No eval, no network. Compile once, run per row.
//
//   Examples:
//     upper(trim(value))
//     concat($First, " ", $Last)
//     if(len(value) > 5, "long", "short")
//     replace(value, "-", "")
//     part(value, "@", 1)            // domain of an email
//     coalesce($Nickname, $First, "N/A")

import { CellValue } from './types'

export interface EvalContext {
  value: CellValue
  row: Record<string, CellValue>
}

type Node =
  | { k: 'lit'; v: CellValue }
  | { k: 'value' }
  | { k: 'col'; name: string }
  | { k: 'unary'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }

// ---- Lexer ------------------------------------------------------------------

type Tok = { t: string; v?: string }

function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c)
  const isId = (c: string) => /[A-Za-z0-9_]/.test(c)
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      i++
      let s = ''
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1]
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n
          i += 2
        } else {
          s += src[i++]
        }
      }
      i++ // closing quote
      toks.push({ t: 'str', v: s })
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let s = ''
      while (i < src.length && /[0-9.]/.test(src[i])) s += src[i++]
      toks.push({ t: 'num', v: s })
      continue
    }
    if (c === '$') {
      i++
      let s = ''
      while (i < src.length && isId(src[i])) s += src[i++]
      toks.push({ t: 'col', v: s })
      continue
    }
    if (c === '[') {
      i++
      let s = ''
      while (i < src.length && src[i] !== ']') s += src[i++]
      i++ // ]
      toks.push({ t: 'col', v: s })
      continue
    }
    if (isIdStart(c)) {
      let s = ''
      while (i < src.length && isId(src[i])) s += src[i++]
      toks.push({ t: 'id', v: s })
      continue
    }
    // multi-char operators
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      toks.push({ t: two })
      i += 2
      continue
    }
    if ('+-*/%<>(),'.includes(c)) {
      toks.push({ t: c })
      i++
      continue
    }
    throw new ExprError(`Unexpected character "${c}"`)
  }
  toks.push({ t: 'eof' })
  return toks
}

export class ExprError extends Error {}

// ---- Parser (Pratt) ---------------------------------------------------------

const BIN_PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6
}

class Parser {
  toks: Tok[]
  pos = 0
  constructor(toks: Tok[]) {
    this.toks = toks
  }
  peek(): Tok {
    return this.toks[this.pos]
  }
  next(): Tok {
    return this.toks[this.pos++]
  }
  expect(t: string): Tok {
    const tok = this.next()
    if (tok.t !== t) throw new ExprError(`Expected "${t}"`)
    return tok
  }
  parse(): Node {
    const n = this.expr(0)
    if (this.peek().t !== 'eof') throw new ExprError('Unexpected trailing input')
    return n
  }
  expr(min: number): Node {
    let left = this.unary()
    for (;;) {
      const op = this.peek().t
      const prec = BIN_PREC[op]
      if (prec === undefined || prec < min) break
      this.next()
      const right = this.expr(prec + 1)
      left = { k: 'bin', op, a: left, b: right }
    }
    return left
  }
  unary(): Node {
    const t = this.peek().t
    if (t === '-' || t === '+') {
      this.next()
      return { k: 'unary', op: t, a: this.unary() }
    }
    return this.primary()
  }
  primary(): Node {
    const tok = this.next()
    switch (tok.t) {
      case 'num':
        return { k: 'lit', v: parseFloat(tok.v!) }
      case 'str':
        return { k: 'lit', v: tok.v! }
      case 'col':
        return { k: 'col', name: tok.v! }
      case 'id': {
        const name = tok.v!
        if (name === 'value') return { k: 'value' }
        if (name === 'true') return { k: 'lit', v: true }
        if (name === 'false') return { k: 'lit', v: false }
        if (name === 'null') return { k: 'lit', v: null }
        if (this.peek().t === '(') {
          this.next()
          const args: Node[] = []
          if (this.peek().t !== ')') {
            args.push(this.expr(0))
            while (this.peek().t === ',') {
              this.next()
              args.push(this.expr(0))
            }
          }
          this.expect(')')
          return { k: 'call', name, args }
        }
        // bare identifier -> treat as column name
        return { k: 'col', name }
      }
      case '(': {
        const n = this.expr(0)
        this.expect(')')
        return n
      }
      default:
        throw new ExprError(`Unexpected token "${tok.t}"`)
    }
  }
}

// ---- Evaluator --------------------------------------------------------------

const S = (v: CellValue): string => (v === null || v === undefined ? '' : String(v))
const N = (v: CellValue): number => {
  if (typeof v === 'number') return v
  const n = parseFloat(S(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : NaN
}

const FUNCS: Record<string, (args: CellValue[]) => CellValue> = {
  upper: (a) => S(a[0]).toUpperCase(),
  lower: (a) => S(a[0]).toLowerCase(),
  trim: (a) => S(a[0]).trim(),
  title: (a) => S(a[0]).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  len: (a) => S(a[0]).length,
  replace: (a) => S(a[0]).split(S(a[1])).join(S(a[2])),
  substr: (a) => S(a[0]).substr(N(a[1]), a[2] === undefined ? undefined : N(a[2])),
  concat: (a) => a.map(S).join(''),
  split: (a) => S(a[0]).split(S(a[1]))[0] ?? '',
  part: (a) => S(a[0]).split(S(a[1]))[Math.trunc(N(a[2]))] ?? '',
  contains: (a) => S(a[0]).includes(S(a[1])),
  startsWith: (a) => S(a[0]).startsWith(S(a[1])),
  endsWith: (a) => S(a[0]).endsWith(S(a[1])),
  coalesce: (a) => a.find((x) => x !== null && x !== undefined && x !== '') ?? null,
  number: (a) => (Number.isFinite(N(a[0])) ? N(a[0]) : null),
  str: (a) => S(a[0]),
  round: (a) => {
    const d = a[1] === undefined ? 0 : Math.trunc(N(a[1]))
    const f = Math.pow(10, d)
    return Math.round(N(a[0]) * f) / f
  },
  abs: (a) => Math.abs(N(a[0])),
  if: (a) => (truthy(a[0]) ? a[1] : a[2] ?? null),
  regexReplace: (a) => {
    try {
      return S(a[0]).replace(new RegExp(S(a[1]), 'g'), S(a[2]))
    } catch {
      return a[0]
    }
  }
}

function truthy(v: CellValue): boolean {
  if (v === null || v === undefined || v === '' || v === false) return false
  if (v === 0) return false
  return true
}

function evalNode(n: Node, ctx: EvalContext): CellValue {
  switch (n.k) {
    case 'lit':
      return n.v
    case 'value':
      return ctx.value
    case 'col':
      return ctx.row[n.name] ?? null
    case 'unary': {
      const a = evalNode(n.a, ctx)
      return n.op === '-' ? -N(a) : +N(a)
    }
    case 'call': {
      const fn = FUNCS[n.name]
      if (!fn) throw new ExprError(`Unknown function "${n.name}"`)
      return fn(n.args.map((x) => evalNode(x, ctx)))
    }
    case 'bin': {
      const a = evalNode(n.a, ctx)
      if (n.op === '&&') return truthy(a) ? evalNode(n.b, ctx) : a
      if (n.op === '||') return truthy(a) ? a : evalNode(n.b, ctx)
      const b = evalNode(n.b, ctx)
      switch (n.op) {
        case '+':
          return typeof a === 'string' || typeof b === 'string' ? S(a) + S(b) : N(a) + N(b)
        case '-':
          return N(a) - N(b)
        case '*':
          return N(a) * N(b)
        case '/':
          return N(a) / N(b)
        case '%':
          return N(a) % N(b)
        case '==':
          return S(a) === S(b)
        case '!=':
          return S(a) !== S(b)
        case '<':
          return N(a) < N(b)
        case '<=':
          return N(a) <= N(b)
        case '>':
          return N(a) > N(b)
        case '>=':
          return N(a) >= N(b)
      }
    }
  }
  return null
}

export interface CompiledExpr {
  eval: (ctx: EvalContext) => CellValue
}

export function compileExpression(src: string): CompiledExpr {
  const ast = new Parser(lex(src)).parse()
  return { eval: (ctx) => evalNode(ast, ctx) }
}

/** Validate an expression, returning an error message or null. */
export function checkExpression(src: string): string | null {
  try {
    compileExpression(src)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid expression'
  }
}
