// Column profiling, dataset quality scoring, rule-based suggestions and the
// bundled sample dataset. Ports of src/engine/{stats,quality,suggest,sample}.ts.
import Foundation

// MARK: - Profiling (stats.ts)

struct NumericStats: Equatable {
    var min: Double
    var max: Double
    var mean: Double
    var median: Double
    var sum: Double
    var std: Double
}

struct ColumnProfileResult: Equatable {
    var name: String
    var type: ColType
    var total: Int
    var filled: Int
    var blank: Int
    var distinct: Int
    var numeric: NumericStats?
    var histogramBins: [Int]?
    var histogramMin: Double?
    var histogramMax: Double?
    var textMinLen: Int?
    var textMaxLen: Int?
    var textAvgLen: Double?
    var dateMin: String?
    var dateMax: String?
}

enum Stats {
    private static func toNumbers(_ values: [Cell]) -> [Double] {
        values.compactMap { v in
            if v.isBlank { return nil }
            let n = v.n
            return n.isFinite ? n : nil
        }
    }

    private static func numericStats(_ ns: [Double]) -> NumericStats {
        let sorted = ns.sorted()
        let sum = ns.reduce(0, +)
        let mean = sum / Double(ns.count)
        let mid = sorted.count / 2
        let median = sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
        let variance = ns.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(ns.count)
        return NumericStats(min: sorted.first!, max: sorted.last!,
                            mean: mean, median: median, sum: sum, std: sqrt(variance))
    }

    private static func histogram(_ ns: [Double], binCount: Int = 14) -> (bins: [Int], min: Double, max: Double) {
        let mn = ns.min()!, mx = ns.max()!
        var bins = [Int](repeating: 0, count: binCount)
        if mx == mn {
            bins[0] = ns.count
            return (bins, mn, mx)
        }
        let width = (mx - mn) / Double(binCount)
        for n in ns {
            var idx = Int((n - mn) / width)
            if idx >= binCount { idx = binCount - 1 }
            if idx < 0 { idx = 0 }
            bins[idx] += 1
        }
        return (bins, mn, mx)
    }

    static func columnProfile(_ t: DataTable, name: String) -> ColumnProfileResult? {
        guard let col = t.column(named: name) else { return nil }
        var filled = 0
        var distinct = Set<String>()
        for v in col.values where !v.isBlank {
            filled += 1
            distinct.insert(v.s)
        }
        var prof = ColumnProfileResult(name: name, type: col.type,
                                       total: col.values.count, filled: filled,
                                       blank: col.values.count - filled,
                                       distinct: distinct.count)
        switch col.type {
        case .integer, .decimal:
            let ns = toNumbers(col.values)
            if !ns.isEmpty {
                prof.numeric = numericStats(ns)
                let h = histogram(ns)
                prof.histogramBins = h.bins
                prof.histogramMin = h.min
                prof.histogramMax = h.max
            }
        case .date:
            var isos: [String] = []
            for v in col.values where !v.isBlank {
                isos.append(Dataframe.normalizeDate(v.s) ?? v.s)
            }
            isos.sort()
            if !isos.isEmpty {
                prof.dateMin = isos.first
                prof.dateMax = isos.last
            }
        default:
            var minLen = Int.max, maxLen = 0, sumLen = 0, n = 0
            for v in col.values where !v.isBlank {
                let len = v.s.count
                minLen = Swift.min(minLen, len)
                maxLen = Swift.max(maxLen, len)
                sumLen += len
                n += 1
            }
            if n > 0 {
                prof.textMinLen = minLen == Int.max ? 0 : minLen
                prof.textMaxLen = maxLen
                prof.textAvgLen = Double(sumLen) / Double(n)
            }
        }
        return prof
    }
}

// MARK: - Quality (quality.ts)

struct ColumnHealth: Identifiable, Equatable {
    var id: String { name }
    var name: String
    var completeness: Double
    var issues: [String]
}

struct Quality: Equatable {
    var score: Int
    var completeness: Double
    var duplicateRows: Int
    var totalCells: Int
    var emptyCells: Int
    var columns: [ColumnHealth]

    static let empty = Quality(score: 100, completeness: 1, duplicateRows: 0,
                               totalCells: 0, emptyCells: 0, columns: [])
}

enum QualityScorer {
    static func datasetQuality(_ t: DataTable) -> Quality {
        let totalCells = t.nrows * t.columns.count
        var emptyCells = 0
        var columns: [ColumnHealth] = []
        var columnsWithIssues = 0
        let multiSpace = try! NSRegularExpression(pattern: "\\s{2,}")

        for c in t.columns {
            var blank = 0
            var whitespace = 0
            var caseKeys: [String: Set<String>] = [:]
            for v in c.values {
                if v.isBlank { blank += 1; continue }
                if case .text(let raw) = v {
                    if raw != raw.trimmingCharacters(in: .whitespacesAndNewlines)
                        || Dataframe.matches(multiSpace, raw) {
                        whitespace += 1
                    }
                }
                if c.type == .text {
                    let raw = v.s
                    let key = raw.trimmingCharacters(in: .whitespaces).lowercased()
                    caseKeys[key, default: []].insert(raw)
                }
            }
            emptyCells += blank
            let filled = c.values.count - blank
            let completeness = c.values.isEmpty ? 1 : Double(filled) / Double(c.values.count)

            let nonBlank = c.values.filter { !$0.isBlank }
            let detected = Dataframe.detectType(nonBlank)
            let typeMixed = !nonBlank.isEmpty && detected != c.type && c.type != .text

            var issues: [String] = []
            if blank > 0 { issues.append("\(blank) blank") }
            if whitespace > 0 { issues.append("\(whitespace) with stray spaces") }
            let variantGroups = caseKeys.values.filter { $0.count > 1 }.count
            if variantGroups > 0 {
                issues.append("\(variantGroups) inconsistent value\(variantGroups == 1 ? "" : "s")")
            }
            if typeMixed { issues.append("looks like \(detected.rawValue)") }

            if !issues.isEmpty { columnsWithIssues += 1 }
            columns.append(ColumnHealth(name: c.name, completeness: completeness, issues: issues))
        }

        var seen = Set<String>()
        var duplicateRows = 0
        for i in 0..<t.nrows {
            let key = t.columns.map { $0.values[i].s }.joined(separator: "\u{1F}")
            if seen.contains(key) { duplicateRows += 1 } else { seen.insert(key) }
        }

        let completeness = totalCells > 0 ? Double(totalCells - emptyCells) / Double(totalCells) : 1
        let penalty = min(15, duplicateRows * 3) + min(20, columnsWithIssues * 4)
        let score = max(0, Int((completeness * 100).rounded()) - penalty)
        return Quality(score: score, completeness: completeness, duplicateRows: duplicateRows,
                       totalCells: totalCells, emptyCells: emptyCells, columns: columns)
    }
}

// MARK: - Suggestions (suggest.ts)

struct Suggestion: Identifiable, Equatable {
    var id: String
    var title: String
    var detail: String
    var symbol: String // SF Symbol name
    var opType: OpType
    var params: [String: ParamValue]
}

enum Suggest {
    static func fixes(_ t: DataTable) -> [Suggestion] {
        var out: [Suggestion] = []
        if t.nrows == 0 { return out }
        let multiSpace = try! NSRegularExpression(pattern: "\\s{2,}")

        // 1. Whitespace to trim
        let dirty = t.columns.filter { c in
            c.values.contains { v in
                if case .text(let s) = v {
                    return s != s.trimmingCharacters(in: .whitespacesAndNewlines)
                        || Dataframe.matches(multiSpace, s)
                }
                return false
            }
        }
        if !dirty.isEmpty {
            out.append(Suggestion(
                id: "trim",
                title: "Trim whitespace",
                detail: "\(dirty.count) column\(dirty.count == 1 ? "" : "s") with stray spaces",
                symbol: "eraser",
                opType: .trim,
                params: ["columns": .stringList(dirty.map(\.name))]))
        }

        // 2. Empty rows
        var emptyRows = 0
        for i in 0..<t.nrows where t.columns.allSatisfy({ $0.values[i].isBlank }) {
            emptyRows += 1
        }
        if emptyRows > 0 {
            out.append(Suggestion(
                id: "emptyrows",
                title: "Remove \(emptyRows) empty row\(emptyRows == 1 ? "" : "s")",
                detail: "Rows with no values at all",
                symbol: "rectangle.split.3x1",
                opType: .removeEmptyRows, params: [:]))
        }

        // 3. Empty columns
        let emptyCols = t.columns.filter { $0.values.allSatisfy(\.isBlank) }
        if !emptyCols.isEmpty {
            out.append(Suggestion(
                id: "emptycols",
                title: "Remove \(emptyCols.count) empty column\(emptyCols.count == 1 ? "" : "s")",
                detail: emptyCols.map(\.name).joined(separator: ", "),
                symbol: "rectangle.split.3x3",
                opType: .removeEmptyColumns, params: [:]))
        }

        // 4. Exact duplicate rows
        var seen = Set<String>()
        var dups = 0
        for i in 0..<t.nrows {
            let key = t.columns.map { $0.values[i].s }.joined(separator: "\u{1F}")
            if seen.contains(key) { dups += 1 } else { seen.insert(key) }
        }
        if dups > 0 {
            out.append(Suggestion(
                id: "dups",
                title: "Remove \(dups) duplicate row\(dups == 1 ? "" : "s")",
                detail: "Exact duplicates across all columns",
                symbol: "doc.on.doc",
                opType: .dedupeRows, params: [:]))
        }

        // 5. Date columns not in ISO form
        for c in t.columns where c.type != .date {
            var nonBlank = 0, dateLike = 0, needsFix = 0
            for v in c.values where !v.isBlank {
                nonBlank += 1
                if let iso = Dataframe.normalizeDate(v.s) {
                    dateLike += 1
                    if iso != v.s { needsFix += 1 }
                }
            }
            if nonBlank >= 3, Double(dateLike) / Double(nonBlank) >= 0.7, needsFix > 0 {
                out.append(Suggestion(
                    id: "date_\(c.name)",
                    title: "Standardise dates in \u{201C}\(c.name)\u{201D}",
                    detail: "\(needsFix) value\(needsFix == 1 ? "" : "s") in mixed formats \u{2192} ISO",
                    symbol: "calendar",
                    opType: .standardizeDate,
                    params: ["column": .string(c.name)]))
            }
        }

        // 6. Inconsistent capitalisation / spacing variants
        for c in t.columns where c.type == .text {
            var groups: [String: [String: Int]] = [:]
            for v in c.values where !v.isBlank {
                let raw = v.s
                let key = raw.trimmingCharacters(in: .whitespaces).lowercased()
                groups[key, default: [:]][raw, default: 0] += 1
            }
            var mapping: [String: String] = [:]
            var variantGroups = 0
            for g in groups.values where g.count >= 2 {
                variantGroups += 1
                // most-frequent variant wins; ties broken lexicographically for determinism
                let rawCanonical = g.max { ($0.value, $1.key) < ($1.value, $0.key) }!.key
                let canonical = rawCanonical.trimmingCharacters(in: .whitespacesAndNewlines)
                    .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                for raw in g.keys where raw != canonical { mapping[raw] = canonical }
            }
            if variantGroups > 0, !mapping.isEmpty {
                out.append(Suggestion(
                    id: "case_\(c.name)",
                    title: "Unify values in \u{201C}\(c.name)\u{201D}",
                    detail: "\(variantGroups) value\(variantGroups == 1 ? "" : "s") written inconsistently",
                    symbol: "square.stack.3d.up",
                    opType: .clusterMerge,
                    params: ["column": .string(c.name), "mapping": .mapping(mapping)]))
            }
        }

        return out
    }
}

// MARK: - Sample data (sample.ts)

enum SampleData {
    static func table() -> DataTable {
        let header = ["Name", "Country", "Signup Date", "Phone", "Plan", "Revenue"]
        let rows: [[String?]] = [
            ["  Ada Lovelace ", "United States", "2024-01-15", "(415) 555-0100", "Pro", "1200"],
            ["grace hopper", "USA", "15/02/2024", "415-555-0142", "pro", "1,200"],
            ["Alan Turing", "U.S.A.", "Mar 3, 2024", "+1 415 555 0199", "Enterprise", "4800"],
            ["Katherine Johnson", "United Kingdom", "2024-02-28", "020 7946 0958", "PRO", "1200"],
            ["katherine johnson", "UK", "28/02/2024", "02079460958", "Pro", ""],
            ["Linus Torvalds", "Finland", "2024/04/11", "", "enterprise", "4800"],
            ["MARGARET HAMILTON", "United States", "11 Apr 2024", "415.555.0170", "Pro ", "1200"],
            ["Dennis Ritchie", "usa", "", "+14155550111", "Basic", "299"],
            ["Ada Lovelace", "United States", "2024-01-15", "(415) 555-0100", "Pro", "1200"],
            ["Barbara Liskov", "United  States", "2024-05-06", "415 555 0123", "basic", "299"],
            ["  Tim Berners-Lee", "U.K.", "06/05/2024", "+44 20 7946 0000", "Enterprise", "4,800"],
            ["Donald Knuth", "United States", "May 20, 2024", "", "pro", "1200"],
            ["", "Germany", "2024-06-01", "+49 30 123456", "Basic", "299"],
            ["Edsger Dijkstra", "netherlands", "01/06/2024", "+31 20 1234567", "Pro", "1200"],
            ["john von neumann", "United States", "2024-03-19", "(415) 555-0188", "enterprise", "4800"]
        ]
        let cells: [[Cell]] = rows.map { row in
            row.map { $0.map { .text($0) } ?? .null }
        }
        return Dataframe.tableFromRows(header: header, rows: cells)
    }
}
