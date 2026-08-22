// Deterministic string algorithms + the safe expression language.
// Ports of src/engine/algorithms.ts and src/engine/expression.ts.
import Foundation

// MARK: - String similarity

enum Algorithms {
    static func levenshtein(_ a: String, _ b: String) -> Int {
        if a == b { return 0 }
        let aa = Array(a.unicodeScalars), bb = Array(b.unicodeScalars)
        let m = aa.count, n = bb.count
        if m == 0 { return n }
        if n == 0 { return m }
        var prev = Array(0...n)
        var curr = [Int](repeating: 0, count: n + 1)
        for i in 1...m {
            curr[0] = i
            let ca = aa[i - 1]
            for j in 1...n {
                let cost = ca == bb[j - 1] ? 0 : 1
                curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
            }
            swap(&prev, &curr)
        }
        return prev[n]
    }

    static func editSimilarity(_ a: String, _ b: String) -> Double {
        let maxLen = max(a.count, b.count)
        if maxLen == 0 { return 1 }
        return 1 - Double(levenshtein(a, b)) / Double(maxLen)
    }

    static func jaroWinkler(_ s1: String, _ s2: String) -> Double {
        if s1 == s2 { return 1 }
        let a = Array(s1), b = Array(s2)
        let len1 = a.count, len2 = b.count
        if len1 == 0 || len2 == 0 { return 0 }
        let matchDistance = max(0, max(len1, len2) / 2 - 1)
        var m1 = [Bool](repeating: false, count: len1)
        var m2 = [Bool](repeating: false, count: len2)
        var matches = 0
        for i in 0..<len1 {
            let start = max(0, i - matchDistance)
            let end = min(i + matchDistance + 1, len2)
            if start >= end { continue }
            for j in start..<end {
                if m2[j] || a[i] != b[j] { continue }
                m1[i] = true; m2[j] = true; matches += 1
                break
            }
        }
        if matches == 0 { return 0 }
        var t = 0.0
        var k = 0
        for i in 0..<len1 where m1[i] {
            while !m2[k] { k += 1 }
            if a[i] != b[k] { t += 1 }
            k += 1
        }
        t /= 2
        let mm = Double(matches)
        let jaro = (mm / Double(len1) + mm / Double(len2) + (mm - t) / mm) / 3
        var prefix = 0
        for i in 0..<min(4, len1, len2) {
            if a[i] == b[i] { prefix += 1 } else { break }
        }
        return jaro + Double(prefix) * 0.1 * (1 - jaro)
    }

    /// OpenRefine-style key-collision fingerprint.
    static func fingerprint(_ s: String) -> String {
        let lowered = s.trimmingCharacters(in: .whitespaces).lowercased()
            .folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US_POSIX"))
        var cleaned = ""
        for ch in lowered {
            if ch.isLetter && ch.isASCII || ch.isNumber && ch.isASCII || ch == " " {
                cleaned.append(ch)
            } else if ch.isLetter || ch.isNumber {
                continue // non-ascii letters dropped after folding, mirroring [^a-z0-9\s]
            } else {
                cleaned.append(" ")
            }
        }
        let tokens = Set(cleaned.split(separator: " ").map(String.init))
        return tokens.sorted().joined(separator: " ")
    }

    static func ngramFingerprint(_ s: String, n: Int = 2) -> String {
        let clean = s.lowercased().filter { ($0.isLetter || $0.isNumber) && $0.isASCII }
        let chars = Array(clean)
        guard chars.count >= n else { return clean }
        var grams = Set<String>()
        for i in 0...(chars.count - n) {
            grams.insert(String(chars[i..<(i + n)]))
        }
        return grams.sorted().joined()
    }

    struct ClusterMember: Equatable {
        var value: String
        var count: Int
    }
    struct Cluster: Identifiable, Equatable {
        var id: String { key }
        var key: String
        var values: [ClusterMember]
        var suggestion: String
        var total: Int
    }
    enum ClusterMethod: String, CaseIterable {
        case fingerprint, ngram, levenshtein
        var label: String {
            switch self {
            case .fingerprint: return "Fingerprint"
            case .ngram: return "N-gram"
            case .levenshtein: return "Nearest neighbour"
            }
        }
    }

    static func buildClusters(_ distinct: [ClusterMember],
                              method: ClusterMethod,
                              threshold: Double = 0.82) -> [Cluster] {
        if method == .levenshtein { return buildNearestClusters(distinct, threshold: threshold) }
        let keyFn: (String) -> String = method == .ngram ? { ngramFingerprint($0) } : fingerprint
        var order: [String] = []
        var groups: [String: [ClusterMember]] = [:]
        for d in distinct {
            let k = keyFn(d.value)
            if k.isEmpty { continue }
            if groups[k] == nil { order.append(k); groups[k] = [] }
            groups[k]!.append(d)
        }
        var clusters: [Cluster] = []
        for key in order {
            let members = groups[key]!
            if members.count < 2 { continue }
            clusters.append(makeCluster(key, members))
        }
        return clusters.sorted { $0.total > $1.total }
    }

    private static func buildNearestClusters(_ distinct: [ClusterMember], threshold: Double) -> [Cluster] {
        var used = [Bool](repeating: false, count: distinct.count)
        var clusters: [Cluster] = []
        for i in 0..<distinct.count {
            if used[i] { continue }
            var members = [distinct[i]]
            used[i] = true
            for j in (i + 1)..<distinct.count {
                if used[j] { continue }
                let sim = jaroWinkler(distinct[i].value.lowercased(), distinct[j].value.lowercased())
                if sim >= threshold {
                    members.append(distinct[j])
                    used[j] = true
                }
            }
            if members.count >= 2 { clusters.append(makeCluster("nn_\(i)", members)) }
        }
        return clusters.sorted { $0.total > $1.total }
    }

    private static func makeCluster(_ key: String, _ members: [ClusterMember]) -> Cluster {
        let sorted = members.sorted { $0.count > $1.count }
        return Cluster(key: key,
                       values: sorted,
                       suggestion: sorted[0].value,
                       total: sorted.reduce(0) { $0 + $1.count })
    }
}

// MARK: - Expression language

struct ExprError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum Expression {
    struct Context {
        var value: Cell
        var row: [String: Cell]
    }

    indirect enum Node {
        case lit(Cell)
        case value
        case col(String)
        case unary(String, Node)
        case bin(String, Node, Node)
        case call(String, [Node])
    }

    struct Tok { var t: String; var v: String = "" }

    static func lex(_ src: String) -> Result<[Tok], ExprError> {
        var toks: [Tok] = []
        let chars = Array(src)
        var i = 0
        func isIdStart(_ c: Character) -> Bool { c.isLetter || c == "_" }
        func isId(_ c: Character) -> Bool { c.isLetter || c.isNumber || c == "_" }
        while i < chars.count {
            let c = chars[i]
            if c.isWhitespace { i += 1; continue }
            if c == "\"" || c == "'" {
                let q = c
                i += 1
                var s = ""
                while i < chars.count, chars[i] != q {
                    if chars[i] == "\\", i + 1 < chars.count {
                        let n = chars[i + 1]
                        s.append(n == "n" ? "\n" : n == "t" ? "\t" : String(n))
                        i += 2
                    } else {
                        s.append(chars[i]); i += 1
                    }
                }
                i += 1
                toks.append(Tok(t: "str", v: s))
                continue
            }
            if c.isNumber || (c == "." && i + 1 < chars.count && chars[i + 1].isNumber) {
                var s = ""
                while i < chars.count, chars[i].isNumber || chars[i] == "." { s.append(chars[i]); i += 1 }
                toks.append(Tok(t: "num", v: s))
                continue
            }
            if c == "$" {
                i += 1
                var s = ""
                while i < chars.count, isId(chars[i]) { s.append(chars[i]); i += 1 }
                toks.append(Tok(t: "col", v: s))
                continue
            }
            if c == "[" {
                i += 1
                var s = ""
                while i < chars.count, chars[i] != "]" { s.append(chars[i]); i += 1 }
                i += 1
                toks.append(Tok(t: "col", v: s))
                continue
            }
            if isIdStart(c) {
                var s = ""
                while i < chars.count, isId(chars[i]) { s.append(chars[i]); i += 1 }
                toks.append(Tok(t: "id", v: s))
                continue
            }
            if i + 1 < chars.count {
                let two = String(chars[i]) + String(chars[i + 1])
                if ["==", "!=", "<=", ">=", "&&", "||"].contains(two) {
                    toks.append(Tok(t: two)); i += 2; continue
                }
            }
            if "+-*/%<>(),".contains(c) {
                toks.append(Tok(t: String(c))); i += 1; continue
            }
            return .failure(ExprError(message: "Unexpected character \"\(c)\""))
        }
        toks.append(Tok(t: "eof"))
        return .success(toks)
    }

    static let binPrec: [String: Int] = [
        "||": 1, "&&": 2, "==": 3, "!=": 3,
        "<": 4, "<=": 4, ">": 4, ">=": 4,
        "+": 5, "-": 5, "*": 6, "/": 6, "%": 6
    ]

    final class Parser {
        var toks: [Tok]
        var pos = 0
        init(_ toks: [Tok]) { self.toks = toks }
        func peek() -> Tok { toks[pos] }
        func next() -> Tok { defer { pos += 1 }; return toks[pos] }
        func expect(_ t: String) throws {
            let tok = next()
            if tok.t != t { throw ExprError(message: "Expected \"\(t)\"") }
        }
        func parse() throws -> Node {
            let n = try expr(0)
            if peek().t != "eof" { throw ExprError(message: "Unexpected trailing input") }
            return n
        }
        func expr(_ minPrec: Int) throws -> Node {
            var left = try unary()
            while true {
                let op = peek().t
                guard let prec = binPrec[op], prec >= minPrec else { break }
                _ = next()
                let right = try expr(prec + 1)
                left = .bin(op, left, right)
            }
            return left
        }
        func unary() throws -> Node {
            let t = peek().t
            if t == "-" || t == "+" {
                _ = next()
                return .unary(t, try unary())
            }
            return try primary()
        }
        func primary() throws -> Node {
            let tok = next()
            switch tok.t {
            case "num": return .lit(.number(Double(tok.v) ?? 0))
            case "str": return .lit(.text(tok.v))
            case "col": return .col(tok.v)
            case "id":
                let name = tok.v
                if name == "value" { return .value }
                if name == "true" { return .lit(.bool(true)) }
                if name == "false" { return .lit(.bool(false)) }
                if name == "null" { return .lit(.null) }
                if peek().t == "(" {
                    _ = next()
                    var args: [Node] = []
                    if peek().t != ")" {
                        args.append(try expr(0))
                        while peek().t == "," {
                            _ = next()
                            args.append(try expr(0))
                        }
                    }
                    try expect(")")
                    return .call(name, args)
                }
                return .col(name)
            case "(":
                let n = try expr(0)
                try expect(")")
                return n
            default:
                throw ExprError(message: "Unexpected token \"\(tok.t)\"")
            }
        }
    }

    static func truthy(_ v: Cell) -> Bool {
        switch v {
        case .null: return false
        case .text(let t): return !t.isEmpty
        case .bool(let b): return b
        case .number(let n): return n != 0
        }
    }

    private static func titleCase(_ s: String) -> String {
        var out = ""
        var atWordStart = true
        for ch in s {
            if ch.isWhitespace {
                out.append(ch); atWordStart = true
            } else if atWordStart {
                out.append(Character(ch.uppercased())); atWordStart = false
            } else {
                out.append(Character(ch.lowercased()))
            }
        }
        return out
    }

    static func callFunc(_ name: String, _ a: [Cell]) throws -> Cell {
        func arg(_ i: Int) -> Cell { i < a.count ? a[i] : .null }
        switch name {
        case "upper": return .text(arg(0).s.uppercased())
        case "lower": return .text(arg(0).s.lowercased())
        case "trim": return .text(arg(0).s.trimmingCharacters(in: .whitespacesAndNewlines))
        case "title": return .text(titleCase(arg(0).s))
        case "len": return .number(Double(arg(0).s.count))
        case "replace":
            return .text(arg(0).s.components(separatedBy: arg(1).s).joined(separator: arg(2).s))
        case "substr":
            let s = Array(arg(0).s)
            let start = max(0, Int(arg(1).n.isFinite ? arg(1).n : 0))
            if start >= s.count { return .text("") }
            let len = a.count > 2 ? Int(arg(2).n.isFinite ? arg(2).n : 0) : s.count - start
            let end = min(s.count, start + max(0, len))
            return .text(String(s[start..<end]))
        case "concat": return .text(a.map(\.s).joined())
        case "split":
            return .text(arg(0).s.components(separatedBy: arg(1).s).first ?? "")
        case "part":
            let parts = arg(0).s.components(separatedBy: arg(1).s)
            let idx = Int(arg(2).n.isFinite ? arg(2).n : 0)
            return .text(idx >= 0 && idx < parts.count ? parts[idx] : "")
        case "contains": return .bool(arg(0).s.contains(arg(1).s))
        case "startsWith": return .bool(arg(0).s.hasPrefix(arg(1).s))
        case "endsWith": return .bool(arg(0).s.hasSuffix(arg(1).s))
        case "coalesce":
            for v in a {
                if case .null = v { continue }
                if case .text(let t) = v, t.isEmpty { continue }
                return v
            }
            return .null
        case "number":
            let n = arg(0).n
            return n.isFinite ? .number(n) : .null
        case "str": return .text(arg(0).s)
        case "round":
            let d = a.count > 1 ? Int(arg(1).n.isFinite ? arg(1).n : 0) : 0
            let f = pow(10.0, Double(d))
            return .number((arg(0).n * f).rounded() / f)
        case "abs": return .number(abs(arg(0).n))
        case "if": return truthy(arg(0)) ? arg(1) : (a.count > 2 ? arg(2) : .null)
        case "regexReplace":
            guard let re = try? NSRegularExpression(pattern: arg(1).s) else { return arg(0) }
            let s = arg(0).s
            let range = NSRange(s.startIndex..., in: s)
            return .text(re.stringByReplacingMatches(in: s, range: range, withTemplate: arg(2).s))
        default:
            throw ExprError(message: "Unknown function \"\(name)\"")
        }
    }

    static func evalNode(_ n: Node, _ ctx: Context) throws -> Cell {
        switch n {
        case .lit(let v): return v
        case .value: return ctx.value
        case .col(let name): return ctx.row[name] ?? .null
        case .unary(let op, let a):
            let v = try evalNode(a, ctx)
            return .number(op == "-" ? -v.n : +v.n)
        case .call(let name, let args):
            return try callFunc(name, try args.map { try evalNode($0, ctx) })
        case .bin(let op, let an, let bn):
            let a = try evalNode(an, ctx)
            if op == "&&" { return truthy(a) ? try evalNode(bn, ctx) : a }
            if op == "||" { return truthy(a) ? a : try evalNode(bn, ctx) }
            let b = try evalNode(bn, ctx)
            switch op {
            case "+":
                if case .text = a { return .text(a.s + b.s) }
                if case .text = b { return .text(a.s + b.s) }
                return .number(a.n + b.n)
            case "-": return .number(a.n - b.n)
            case "*": return .number(a.n * b.n)
            case "/": return .number(a.n / b.n)
            case "%": return .number(a.n.truncatingRemainder(dividingBy: b.n))
            case "==": return .bool(a.s == b.s)
            case "!=": return .bool(a.s != b.s)
            case "<": return .bool(a.n < b.n)
            case "<=": return .bool(a.n <= b.n)
            case ">": return .bool(a.n > b.n)
            case ">=": return .bool(a.n >= b.n)
            default: return .null
            }
        }
    }

    struct Compiled {
        let node: Node
        func eval(_ ctx: Context) -> Cell {
            (try? evalNode(node, ctx)) ?? .null
        }
    }

    static func compile(_ src: String) throws -> Compiled {
        switch lex(src) {
        case .failure(let e): throw e
        case .success(let toks):
            let node = try Parser(toks).parse()
            return Compiled(node: node)
        }
    }

    /// Validation helper for the UI: nil = OK, otherwise the error message.
    static func check(_ src: String) -> String? {
        do { _ = try compile(src); return nil }
        catch let e as ExprError { return e.message }
        catch { return "Invalid expression" }
    }
}
