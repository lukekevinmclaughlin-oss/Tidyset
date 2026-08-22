// The transform registry + pipeline folding. Port of src/engine/transforms.ts
// and src/engine/pipeline.ts. Deterministic; failures leave the table unchanged.
import Foundation

enum Transforms {

    private static func pickColumnIndexes(_ t: DataTable, _ names: [String]) -> [Int] {
        let set = Set(names)
        return t.columns.indices.filter { set.contains(t.columns[$0].name) }
    }

    private static func keepRows(_ t: DataTable, _ keep: (Int) -> Bool) -> DataTable {
        var idx: [Int] = []
        for i in 0..<t.nrows where keep(i) { idx.append(i) }
        let columns = t.columns.map { c in
            Column(id: c.id, name: c.name, type: c.type, values: idx.map { c.values[$0] })
        }
        return DataTable(columns: columns, nrows: idx.count)
    }

    private static func collapseWhitespace(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
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

    static func apply(_ t: DataTable, _ op: TidyOp) -> DataTable {
        var out = t
        switch op.type {

        case .trim:
            for ci in pickColumnIndexes(out, op.list("columns")) {
                out.columns[ci].values = out.columns[ci].values.map {
                    $0.isBlank ? $0 : .text(collapseWhitespace($0.s))
                }
            }

        case .changeCase:
            let mode = op.str("mode")
            let fn: (String) -> String = mode == "upper"
                ? { $0.uppercased() }
                : mode == "lower" ? { $0.lowercased() } : titleCase
            for ci in pickColumnIndexes(out, op.list("columns")) {
                out.columns[ci].values = out.columns[ci].values.map {
                    $0.isBlank ? $0 : .text(fn($0.s))
                }
            }

        case .replace:
            let find = op.str("find")
            let replaceWith = op.str("replaceWith")
            let caseInsensitive = op.flag("caseInsensitive")
            let useRe = op.flag("regex")
            var re: NSRegularExpression?
            if useRe {
                re = try? NSRegularExpression(pattern: find,
                                              options: caseInsensitive ? [.caseInsensitive] : [])
            } else if caseInsensitive {
                let esc = NSRegularExpression.escapedPattern(for: find)
                re = try? NSRegularExpression(pattern: esc, options: [.caseInsensitive])
            }
            for ci in pickColumnIndexes(out, op.list("columns")) {
                out.columns[ci].values = out.columns[ci].values.map { v in
                    if v.isBlank { return v }
                    let s = v.s
                    if let re {
                        let range = NSRange(s.startIndex..., in: s)
                        let template = NSRegularExpression.escapedTemplate(for: replaceWith)
                        return .text(re.stringByReplacingMatches(
                            in: s, range: range,
                            withTemplate: useRe ? replaceWith : template))
                    }
                    if find.isEmpty { return v }
                    return .text(s.components(separatedBy: find).joined(separator: replaceWith))
                }
            }

        case .extract:
            guard let src = out.column(named: op.str("column")),
                  let re = try? NSRegularExpression(pattern: op.str("pattern")) else { break }
            let values: [Cell] = src.values.map { v in
                if v.isBlank { return .null }
                let s = v.s
                let range = NSRange(s.startIndex..., in: s)
                guard let m = re.firstMatch(in: s, range: range) else { return .null }
                let groupRange = m.numberOfRanges > 1 ? m.range(at: 1) : m.range(at: 0)
                let use = groupRange.location != NSNotFound ? groupRange : m.range(at: 0)
                guard let r = Range(use, in: s) else { return .null }
                return .text(String(s[r]))
            }
            let into = op.str("into")
            out.columns.append(Column(id: UID.make("col"),
                                      name: into.isEmpty ? "\(op.str("column"))_extract" : into,
                                      type: .text, values: values))

        case .splitColumn:
            guard let srcIdx = out.columnIndex(named: op.str("column")) else { break }
            let delimiter = op.str("delimiter")
            guard !delimiter.isEmpty else { break }
            let src = out.columns[srcIdx]
            let parts: [[String]] = src.values.map { $0.isBlank ? [] : $0.s.components(separatedBy: delimiter) }
            let maxParts = parts.reduce(0) { max($0, $1.count) }
            var newCols: [Column] = []
            for k in 0..<maxParts {
                newCols.append(Column(
                    id: UID.make("col"),
                    name: "\(src.name)_\(k + 1)",
                    type: .text,
                    values: parts.map { k < $0.count ? .text($0[k]) : .null }))
            }
            out.columns.insert(contentsOf: newCols, at: srcIdx + 1)
            if !op.flag("keepOriginal") { out.columns.remove(at: srcIdx) }

        case .mergeColumns:
            let idxs = pickColumnIndexes(out, op.list("columns"))
            guard !idxs.isEmpty else { break }
            let separator = op.params["separator"]?.stringValue ?? " "
            var values: [Cell] = []
            values.reserveCapacity(out.nrows)
            for i in 0..<out.nrows {
                let joined = idxs.map { out.columns[$0].values[i].s }
                    .filter { !$0.isEmpty }
                    .joined(separator: separator)
                values.append(.text(joined))
            }
            let name = op.str("name")
            out.columns.append(Column(id: UID.make("col"),
                                      name: name.isEmpty ? "merged" : name,
                                      type: .text, values: values))

        case .renameColumn:
            if let ci = out.columnIndex(named: op.str("column")) {
                out.columns[ci].name = op.str("name")
            }

        case .deleteColumns:
            let set = Set(op.list("columns"))
            out.columns.removeAll { set.contains($0.name) }

        case .moveColumn:
            guard let idx = out.columnIndex(named: op.str("column")) else { break }
            let j = idx + Int(op.num("dir", 0))
            guard j >= 0, j < out.columns.count else { break }
            let c = out.columns.remove(at: idx)
            out.columns.insert(c, at: j)

        case .changeType:
            if let ci = out.columnIndex(named: op.str("column")),
               let type = ColType(rawValue: op.str("type")) {
                out.columns[ci].type = type
                out.columns[ci].values = out.columns[ci].values.map { Dataframe.coerce($0, type) }
            }

        case .filterRows:
            guard let ci = out.columnIndex(named: op.str("column")) else { break }
            let cmp = op.str("op")
            let val = op.str("value")
            let num = Double(val.replacingOccurrences(of: ",", with: "")) ?? .nan
            let values = out.columns[ci].values
            out = keepRows(out) { i in
                let cell = values[i]
                let s = cell.s
                switch cmp {
                case "eq": return s == val
                case "neq": return s != val
                case "contains": return s.lowercased().contains(val.lowercased())
                case "notContains": return !s.lowercased().contains(val.lowercased())
                case "gt": return cell.n > num
                case "lt": return cell.n < num
                case "gte": return cell.n >= num
                case "lte": return cell.n <= num
                case "empty": return cell.isBlank
                case "notEmpty": return !cell.isBlank
                default: return true
                }
            }

        case .removeEmptyRows:
            let cols = out.columns
            out = keepRows(out) { i in cols.contains { !$0.values[i].isBlank } }

        case .removeEmptyColumns:
            out.columns.removeAll { c in c.values.allSatisfy(\.isBlank) }

        case .fillDown:
            for ci in pickColumnIndexes(out, op.list("columns")) {
                out.columns[ci].values = Fill.compute(out.columns[ci], .down)
            }

        case .fillMissing:
            if let ci = out.columnIndex(named: op.str("column")),
               let strategy = FillStrategy(rawValue: op.str("strategy")) {
                let constant: Cell = .text(op.str("value"))
                out.columns[ci].values = Fill.compute(out.columns[ci], strategy, constant: constant)
            }

        case .dedupeRows:
            let names = op.list("columns")
            let keyIdx = names.isEmpty ? Array(out.columns.indices) : pickColumnIndexes(out, names)
            var seen = Set<String>()
            let cols = out.columns
            out = keepRows(out) { i in
                let key = keyIdx.map { cols[$0].values[i].s }.joined(separator: "\u{1F}")
                if seen.contains(key) { return false }
                seen.insert(key)
                return true
            }

        case .clusterMerge:
            if let ci = out.columnIndex(named: op.str("column")) {
                let map = op.params["mapping"]?.mappingValue ?? [:]
                out.columns[ci].values = out.columns[ci].values.map { v in
                    v.isBlank ? v : (map[v.s].map { .text($0) } ?? v)
                }
            }

        case .standardizeDate:
            if let ci = out.columnIndex(named: op.str("column")) {
                out.columns[ci].type = .date
                out.columns[ci].values = out.columns[ci].values.map { v in
                    v.isBlank ? v : (Dataframe.normalizeDate(v.s).map { .text($0) } ?? v)
                }
            }

        case .parseField:
            guard let srcIdx = out.columnIndex(named: op.str("column")) else { break }
            let kind = op.str("kind")
            let part = op.str("part")
            let country = op.params["country"]?.stringValue ?? "1"
            let values = out.columns[srcIdx].values.map {
                FieldParsers.apply($0, kind: kind, part: part, country: country)
            }
            let into = op.str("into")
            if !into.isEmpty {
                out.columns.append(Column(id: UID.make("col"), name: into, type: .text, values: values))
            } else {
                out.columns[srcIdx].values = values
            }

        case .numberFormat:
            if let ci = out.columnIndex(named: op.str("column")) {
                let d = Int(op.num("decimals", 2))
                let f = pow(10.0, Double(d))
                out.columns[ci].values = out.columns[ci].values.map { v in
                    if v.isBlank { return v }
                    let n = v.n
                    guard n.isFinite else { return v }
                    return .number((n * f).rounded() / f)
                }
            }

        case .expression:
            guard let compiled = try? Expression.compile(op.str("expr")) else { break }
            let targetIdx = op.str("mode") == "replace" ? out.columnIndex(named: op.str("target")) : nil
            var values: [Cell] = []
            values.reserveCapacity(out.nrows)
            for i in 0..<out.nrows {
                var row: [String: Cell] = [:]
                for c in out.columns { row[c.name] = c.values[i] }
                let cur: Cell = targetIdx.map { out.columns[$0].values[i] } ?? .null
                values.append(compiled.eval(Expression.Context(value: cur, row: row)))
            }
            if let targetIdx {
                out.columns[targetIdx].values = values
            } else {
                let name = op.str("name")
                out.columns.append(Column(id: UID.make("col"),
                                          name: name.isEmpty ? "expr" : name,
                                          type: .text, values: values))
            }

        case .fuzzyDedupe:
            let names = op.list("columns")
            let keyIdx = names.isEmpty ? Array(out.columns.indices) : pickColumnIndexes(out, names)
            let threshold = op.num("threshold", 0.9)
            let survivorship = op.str("survivorship", "first")
            let cols = out.columns
            func keyOf(_ i: Int) -> String {
                let joined = keyIdx.map { cols[$0].values[i].s }.joined(separator: " ").lowercased()
                var cleaned = ""
                for ch in joined {
                    if (ch.isLetter || ch.isNumber) && ch.isASCII || ch == " " { cleaned.append(ch) }
                }
                return collapseWhitespace(cleaned)
            }
            func blankCount(_ i: Int) -> Int {
                cols.reduce(0) { $0 + ($1.values[i].isBlank ? 1 : 0) }
            }
            let keys = (0..<out.nrows).map(keyOf)
            var removed = [Bool](repeating: false, count: out.nrows)
            var blocks: [Character: [Int]] = [:]
            var blockOrder: [Character] = []
            for i in 0..<out.nrows {
                let b = keys[i].first ?? " "
                if blocks[b] == nil { blocks[b] = []; blockOrder.append(b) }
                blocks[b]!.append(i)
            }
            for b in blockOrder {
                let idxs = blocks[b]!
                for a in 0..<idxs.count {
                    let i = idxs[a]
                    if removed[i] { continue }
                    if a + 1 >= idxs.count { continue }
                    for bb in (a + 1)..<idxs.count {
                        let j = idxs[bb]
                        if removed[j] { continue }
                        if keys[i].isEmpty || keys[j].isEmpty { continue }
                        if Algorithms.jaroWinkler(keys[i], keys[j]) >= threshold {
                            var survivor = i
                            var victim = j
                            if survivorship == "longest", keys[j].count > keys[i].count {
                                survivor = j; victim = i
                            } else if survivorship == "mostComplete", blankCount(j) < blankCount(i) {
                                survivor = j; victim = i
                            }
                            _ = survivor
                            removed[victim] = true
                            if victim == i { break }
                        }
                    }
                }
            }
            out = keepRows(out) { !removed[$0] }
        }
        return out
    }
}

// MARK: - Pipeline (pipeline.ts)

enum Pipeline {
    static func fold(_ source: DataTable, _ ops: [TidyOp], upTo: Int? = nil) -> DataTable {
        var t = source
        let limit = upTo ?? (ops.count - 1)
        var i = 0
        for op in ops {
            if i > limit { break }
            if op.enabled { t = Transforms.apply(t, op) }
            i += 1
        }
        return t
    }

    /// snapshots[0] = source, snapshots[k+1] = table after ops[k].
    static func foldAll(_ source: DataTable, _ ops: [TidyOp]) -> [DataTable] {
        var snapshots: [DataTable] = [source]
        var t = source
        for op in ops {
            if op.enabled { t = Transforms.apply(t, op) }
            snapshots.append(t)
        }
        return snapshots
    }

    struct StepDelta: Equatable {
        var rows: Int
        var addedCols: Int
        var removedCols: Int
        var cells: Int
    }

    static func stepDelta(_ before: DataTable, _ after: DataTable) -> StepDelta {
        let beforeNames = Set(before.columns.map(\.name))
        let afterNames = Set(after.columns.map(\.name))
        let added = afterNames.subtracting(beforeNames).count
        let removed = beforeNames.subtracting(afterNames).count
        var cells = 0
        if before.nrows == after.nrows, added == 0, removed == 0 {
            for (bc, ac) in zip(before.columns, after.columns) where bc.name == ac.name {
                for i in 0..<before.nrows where bc.values[i] != ac.values[i] {
                    cells += 1
                }
            }
        }
        return StepDelta(rows: after.nrows - before.nrows,
                         addedCols: added, removedCols: removed, cells: cells)
    }
}
