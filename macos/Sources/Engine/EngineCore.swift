// Tidyset engine — core types + dataframe. Direct port of the TypeScript
// engine (src/engine/{types,dataframe,parsers,fill}.ts). Everything here is
// pure, deterministic, offline — same input always yields the same output.
import Foundation

// MARK: - Cell

/// JS CellValue = string | number | boolean | null.
enum Cell: Equatable, Hashable {
    case null
    case text(String)
    case number(Double)
    case bool(Bool)

    /// Mirrors JS String(v) for the values we produce ("" for null).
    var s: String {
        switch self {
        case .null: return ""
        case .text(let t): return t
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return Cell.renderNumber(n)
        }
    }

    var isBlank: Bool {
        switch self {
        case .null: return true
        case .text(let t): return t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default: return false
        }
    }

    /// JS Number(v)-ish coercion used by the expression language and stats.
    var n: Double {
        switch self {
        case .number(let x): return x
        case .bool(let b): return b ? 1 : 0
        case .null: return .nan
        case .text(let t):
            let cleaned = t.replacingOccurrences(of: ",", with: "")
            return Double(cleaned.trimmingCharacters(in: .whitespaces)) ?? .nan
        }
    }

    static func renderNumber(_ n: Double) -> String {
        guard n.isFinite else { return n.isNaN ? "NaN" : (n > 0 ? "Infinity" : "-Infinity") }
        if n == n.rounded(), abs(n) < 1e15 {
            return String(Int64(n))
        }
        // Shortest representation, like JS number stringification.
        var out = String(format: "%.10g", n)
        if out.contains("e") { out = "\(n)" }
        return out
    }
}

typealias ColType = TidyColType

enum TidyColType: String, Codable, CaseIterable {
    case text, integer, decimal, date, boolean

    var label: String {
        switch self {
        case .text: return "Text"
        case .integer: return "Integer"
        case .decimal: return "Decimal"
        case .date: return "Date"
        case .boolean: return "Boolean"
        }
    }
}

struct Column: Equatable {
    var id: String
    var name: String
    var type: ColType
    var values: [Cell]
}

struct DataTable: Equatable {
    var columns: [Column]
    var nrows: Int

    static let empty = DataTable(columns: [], nrows: 0)

    func column(named name: String) -> Column? {
        columns.first { $0.name == name }
    }
    func columnIndex(named name: String) -> Int? {
        columns.firstIndex { $0.name == name }
    }
}

// MARK: - Ops / Recipe

enum OpType: String, Codable, CaseIterable {
    case trim, changeCase, replace, extract, splitColumn, mergeColumns
    case renameColumn, deleteColumns, moveColumn, changeType, filterRows
    case removeEmptyRows, removeEmptyColumns, fillDown, fillMissing
    case dedupeRows, clusterMerge, fuzzyDedupe, standardizeDate, parseField
    case numberFormat, expression
}

/// Op params — a JSON-ish bag, serialisable for .tidyset recipes.
enum ParamValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case stringList([String])
    case mapping([String: String])

    var stringValue: String? { if case .string(let s) = self { return s }; return nil }
    var numberValue: Double? { if case .number(let n) = self { return n }; return nil }
    var boolValue: Bool? { if case .bool(let b) = self { return b }; return nil }
    var listValue: [String]? { if case .stringList(let l) = self { return l }; return nil }
    var mappingValue: [String: String]? { if case .mapping(let m) = self { return m }; return nil }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let l = try? c.decode([String].self) { self = .stringList(l); return }
        if let m = try? c.decode([String: String].self) { self = .mapping(m); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported param value")
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .stringList(let l): try c.encode(l)
        case .mapping(let m): try c.encode(m)
        }
    }
}

struct TidyOp: Identifiable, Codable, Equatable {
    var id: String
    var type: OpType
    var label: String
    var enabled: Bool
    var params: [String: ParamValue]

    func str(_ key: String, _ fallback: String = "") -> String {
        params[key]?.stringValue ?? fallback
    }
    func num(_ key: String, _ fallback: Double) -> Double {
        params[key]?.numberValue ?? fallback
    }
    func flag(_ key: String) -> Bool {
        params[key]?.boolValue ?? false
    }
    func list(_ key: String) -> [String] {
        params[key]?.listValue ?? []
    }
}

struct Recipe: Codable {
    var app: String = "tidyset"
    var version: Int = 1
    var name: String
    var createdAt: String
    var ops: [TidyOp]
}

enum UID {
    private static var counter = 0
    private static let lock = NSLock()
    static func make(_ prefix: String = "id") -> String {
        lock.lock(); defer { lock.unlock() }
        counter += 1
        return "\(prefix)_\(String(counter, radix: 36))_\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))"
    }
}

func cloneTable(_ t: DataTable) -> DataTable { t } // value semantics: structs copy

// MARK: - Type inference & coercion (dataframe.ts)

enum Dataframe {
    static let intRe = try! NSRegularExpression(pattern: "^-?\\d{1,15}$")
    static let decRe = try! NSRegularExpression(pattern: "^-?(\\d{1,3}(,\\d{3})*|\\d+)(\\.\\d+)?$")
    static let boolTrue: Set<String> = ["true", "yes", "y", "1"]
    static let boolFalse: Set<String> = ["false", "no", "n", "0"]

    static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        let r = NSRange(s.startIndex..., in: s)
        return re.firstMatch(in: s, range: r) != nil
    }

    private static let months = ["jan", "feb", "mar", "apr", "may", "jun",
                                 "jul", "aug", "sep", "oct", "nov", "dec"]

    private static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    private static func iso(_ y: Int, _ mo: Int, _ d: Int) -> String? {
        guard mo >= 1, mo <= 12, d >= 1, d <= 31 else { return nil }
        return "\(y)-\(pad(mo))-\(pad(d))"
    }

    private static func euroOrUs(_ a: Int, _ b: Int, _ y: Int) -> String? {
        if a > 12, b <= 12 { return iso(y, b, a) }
        if b > 12, a <= 12 { return iso(y, a, b) }
        return iso(y, b, a) // ambiguous -> day-first
    }

    private static func monthIdx(_ s: String) -> Int {
        let key = String(s.prefix(3)).lowercased()
        return (months.firstIndex(of: key) ?? -1) + 1
    }

    private struct DatePattern {
        let re: NSRegularExpression
        let build: ([String]) -> String?
    }

    private static let datePatterns: [DatePattern] = [
        DatePattern(re: try! NSRegularExpression(pattern: "^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$"),
                    build: { m in iso(Int(m[1])!, Int(m[2])!, Int(m[3])!) }),
        DatePattern(re: try! NSRegularExpression(pattern: "^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})$"),
                    build: { m in euroOrUs(Int(m[1])!, Int(m[2])!, Int(m[3])!) }),
        DatePattern(re: try! NSRegularExpression(pattern: "^(\\d{1,2})\\s+([A-Za-z]{3,})\\.?\\s+(\\d{4})$"),
                    build: { m in iso(Int(m[3])!, monthIdx(m[2]), Int(m[1])!) }),
        DatePattern(re: try! NSRegularExpression(pattern: "^([A-Za-z]{3,})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$"),
                    build: { m in iso(Int(m[3])!, monthIdx(m[1]), Int(m[2])!) })
    ]

    static func normalizeDate(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        for p in datePatterns {
            let range = NSRange(s.startIndex..., in: s)
            guard let m = p.re.firstMatch(in: s, range: range) else { continue }
            var groups: [String] = []
            for i in 0..<m.numberOfRanges {
                if let r = Range(m.range(at: i), in: s) { groups.append(String(s[r])) }
                else { groups.append("") }
            }
            if let out = p.build(groups) { return out }
        }
        return nil
    }

    static func detectType(_ values: [Cell]) -> ColType {
        var n = 0, ints = 0, decs = 0, bools = 0, dates = 0
        for v in values {
            if case .null = v { continue }
            if case .text(let t) = v, t.isEmpty { continue }
            let s = v.s.trimmingCharacters(in: .whitespaces)
            n += 1
            if matches(intRe, s) { ints += 1 }
            if matches(decRe, s) { decs += 1 }
            let low = s.lowercased()
            if boolTrue.contains(low) || boolFalse.contains(low) { bools += 1 }
            if normalizeDate(s) != nil { dates += 1 }
        }
        if n == 0 { return .text }
        let d = Double(n)
        if Double(bools) / d == 1 { return .boolean }
        if Double(ints) / d >= 0.95 { return .integer }
        if Double(decs) / d >= 0.95 { return .decimal }
        if Double(dates) / d >= 0.9 { return .date }
        return .text
    }

    static func coerce(_ v: Cell, _ type: ColType) -> Cell {
        if v.isBlank, case .null = v { return .null }
        if case .text(let t) = v, t.isEmpty { return .null }
        let s = v.s.trimmingCharacters(in: .whitespaces)
        switch type {
        case .integer:
            let cleaned = s.replacingOccurrences(of: ",", with: "")
            if let n = Int64(cleaned.split(separator: ".").first.map(String.init) ?? cleaned) {
                return .number(Double(n))
            }
            if let d = Double(cleaned) { return .number(d.rounded(.towardZero)) }
            return v
        case .decimal:
            let cleaned = s.replacingOccurrences(of: ",", with: "")
            if let d = Double(cleaned) { return .number(d) }
            return v
        case .boolean:
            let low = s.lowercased()
            if boolTrue.contains(low) { return .bool(true) }
            if boolFalse.contains(low) { return .bool(false) }
            return v
        case .date:
            return normalizeDate(s).map { .text($0) } ?? v
        case .text:
            return .text(s)
        }
    }

    static func tableFromRows(header: [String], rows: [[Cell]]) -> DataTable {
        let columns: [Column] = header.enumerated().map { ci, name in
            let values: [Cell] = rows.map { r in ci < r.count ? r[ci] : .null }
            let type = detectType(values)
            return Column(id: UID.make("col"),
                          name: name.isEmpty ? "Column \(ci + 1)" : name,
                          type: type, values: values)
        }
        return DataTable(columns: columns, nrows: rows.count)
    }

    static func tableToRows(_ t: DataTable) -> (header: [String], rows: [[Cell]]) {
        let header = t.columns.map(\.name)
        var rows: [[Cell]] = []
        rows.reserveCapacity(t.nrows)
        for i in 0..<t.nrows {
            rows.append(t.columns.map { i < $0.values.count ? $0.values[i] : .null })
        }
        return (header, rows)
    }

    static func completeness(_ values: [Cell]) -> Double {
        if values.isEmpty { return 1 }
        let filled = values.reduce(0) { $0 + ($1.isBlank ? 0 : 1) }
        return Double(filled) / Double(values.count)
    }
}

// MARK: - Structured parsers (parsers.ts)

enum FieldParsers {
    static func normalizePhone(_ raw: String, defaultCountry: String = "1") -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        let hasPlus = trimmed.hasPrefix("+")
        var digits = trimmed.filter(\.isNumber)
        if digits.isEmpty { return nil }
        if hasPlus { return "+" + digits }
        if digits.hasPrefix("00") { return "+" + digits.dropFirst(2) }
        if defaultCountry == "1", digits.count == 10 { return "+1" + digits }
        if defaultCountry == "1", digits.count == 11, digits.hasPrefix("1") { return "+" + digits }
        if digits.hasPrefix("0") { digits = String(digits.dropFirst()) }
        return "+" + defaultCountry + digits
    }

    static func parseName(_ raw: String) -> (first: String, last: String) {
        let s = raw.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        if s.isEmpty { return ("", "") }
        if s.contains(",") {
            let parts = s.split(separator: ",", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            return (parts.count > 1 ? parts[1] : "", parts[0])
        }
        let parts = s.split(separator: " ").map(String.init)
        if parts.count == 1 { return (parts[0], "") }
        return (parts.dropLast().joined(separator: " "), parts.last!)
    }

    static func apply(_ value: Cell, kind: String, part: String, country: String) -> Cell {
        if case .null = value { return .null }
        let s = value.s
        if kind == "phone" {
            return normalizePhone(s, defaultCountry: country).map { .text($0) } ?? .null
        }
        if kind == "name" {
            let (first, last) = parseName(s)
            return .text(part == "last" ? last : first)
        }
        return value
    }
}

// MARK: - Fill strategies (fill.ts)

enum FillStrategy: String, Codable, CaseIterable {
    case down, up, constant, mean, median, mode
}

enum Fill {
    private static func numbers(_ values: [Cell]) -> [Double] {
        values.compactMap { v in
            if v.isBlank { return nil }
            let n = v.n
            return n.isFinite ? n : nil
        }
    }

    static func compute(_ col: Column, _ strategy: FillStrategy, constant: Cell? = nil) -> [Cell] {
        var values = col.values
        switch strategy {
        case .down:
            var last: Cell = .null
            for i in 0..<values.count {
                if values[i].isBlank { values[i] = last } else { last = values[i] }
            }
        case .up:
            var next: Cell = .null
            for i in stride(from: values.count - 1, through: 0, by: -1) {
                if values[i].isBlank { values[i] = next } else { next = values[i] }
            }
        case .constant:
            let c = constant ?? .null
            values = values.map { $0.isBlank ? c : $0 }
        case .mean:
            let ns = numbers(values)
            guard !ns.isEmpty else { return values }
            let mean = ns.reduce(0, +) / Double(ns.count)
            let rounded = (mean * 1e6).rounded() / 1e6
            values = values.map { $0.isBlank ? .number(rounded) : $0 }
        case .median:
            var ns = numbers(values)
            guard !ns.isEmpty else { return values }
            ns.sort()
            let mid = ns.count / 2
            let med = ns.count % 2 == 1 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2
            values = values.map { $0.isBlank ? .number(med) : $0 }
        case .mode:
            var counts: [String: Int] = [:]
            var best: Cell = .null
            var bestN = 0
            for v in values where !v.isBlank {
                let k = v.s
                let n = (counts[k] ?? 0) + 1
                counts[k] = n
                if n > bestN { bestN = n; best = v }
            }
            values = values.map { $0.isBlank ? best : $0 }
        }
        return values
    }
}
