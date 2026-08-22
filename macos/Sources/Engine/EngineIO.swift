// Import/export: CSV/TSV (RFC 4180), JSON, and a dependency-free minimal
// XLSX reader/writer built on a tiny zip implementation (stored + deflate
// entries via the Compression framework). Port of src/engine/io.ts.
import Foundation
import Compression

enum ImportFormat: String {
    case csv, tsv, xlsx, json

    static func detect(from name: String) -> ImportFormat {
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "xlsx", "xls": return .xlsx
        case "json": return .json
        case "tsv": return .tsv
        default: return .csv
        }
    }
}

enum TidyIOError: Error, LocalizedError {
    case unreadable(String)
    var errorDescription: String? {
        if case .unreadable(let why) = self { return why }
        return "Could not read the file."
    }
}

// MARK: - CSV

enum CSV {
    /// RFC 4180 parser with quoted fields, embedded delimiters/newlines and "" escapes.
    static func parse(_ text: String, delimiter: Character = ",") -> [[String]] {
        var rows: [[String]] = []
        var field = ""
        var row: [String] = []
        var inQuotes = false
        var i = text.startIndex
        let end = text.endIndex

        func endField() { row.append(field); field = "" }
        func endRow() {
            endField()
            // skipEmptyLines: 'greedy' — drop rows whose cells are all empty/whitespace
            if !row.allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty }) {
                rows.append(row)
            }
            row = []
        }

        while i < end {
            let c = text[i]
            if inQuotes {
                if c == "\"" {
                    let next = text.index(after: i)
                    if next < end, text[next] == "\"" {
                        field.append("\"")
                        i = next
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(c)
                }
            } else if c == "\"", field.isEmpty {
                inQuotes = true
            } else if c == delimiter {
                endField()
            } else if c == "\r" {
                let next = text.index(after: i)
                if next < end, text[next] == "\n" { i = next }
                endRow()
            } else if c == "\n" {
                endRow()
            } else {
                field.append(c)
            }
            i = text.index(after: i)
        }
        if !field.isEmpty || !row.isEmpty { endRow() }
        return rows
    }

    static func escapeField(_ s: String, delimiter: Character) -> String {
        if s.contains("\"") || s.contains(delimiter) || s.contains("\n") || s.contains("\r") {
            return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return s
    }

    static func unparse(header: [String], rows: [[Cell]], delimiter: Character = ",") -> String {
        var out = header.map { escapeField($0, delimiter: delimiter) }.joined(separator: String(delimiter))
        for r in rows {
            out += "\r\n" + r.map { escapeField($0.s, delimiter: delimiter) }.joined(separator: String(delimiter))
        }
        return out
    }
}

// MARK: - Minimal ZIP

/// Just enough zip for xlsx: read (stored + deflate) and write (stored).
enum MiniZip {
    struct Entry {
        var name: String
        var data: Data
    }

    // ---- reading ----

    static func read(_ data: Data) throws -> [Entry] {
        // find End Of Central Directory (signature 0x06054b50), scan from the end
        let sig: [UInt8] = [0x50, 0x4b, 0x05, 0x06]
        var eocd = -1
        let bytes = [UInt8](data)
        if bytes.count < 22 { throw TidyIOError.unreadable("Not a valid .xlsx file.") }
        var i = bytes.count - 22
        while i >= 0 {
            if bytes[i] == sig[0], bytes[i+1] == sig[1], bytes[i+2] == sig[2], bytes[i+3] == sig[3] {
                eocd = i
                break
            }
            i -= 1
        }
        guard eocd >= 0 else { throw TidyIOError.unreadable("Not a valid .xlsx file.") }
        func u16(_ off: Int) -> Int { Int(bytes[off]) | Int(bytes[off+1]) << 8 }
        func u32(_ off: Int) -> Int {
            Int(bytes[off]) | Int(bytes[off+1]) << 8 | Int(bytes[off+2]) << 16 | Int(bytes[off+3]) << 24
        }
        let count = u16(eocd + 10)
        var offset = u32(eocd + 16)
        var entries: [Entry] = []
        for _ in 0..<count {
            guard u32(offset) == 0x02014b50 else { break }
            let method = u16(offset + 10)
            let compSize = u32(offset + 20)
            let nameLen = u16(offset + 28)
            let extraLen = u16(offset + 30)
            let commentLen = u16(offset + 32)
            let localOffset = u32(offset + 42)
            let name = String(bytes: bytes[(offset + 46)..<(offset + 46 + nameLen)], encoding: .utf8) ?? ""
            // local header: name/extra lengths can differ from central directory
            let lNameLen = u16(localOffset + 26)
            let lExtraLen = u16(localOffset + 28)
            let dataStart = localOffset + 30 + lNameLen + lExtraLen
            let raw = Data(bytes[dataStart..<(dataStart + compSize)])
            let uncompSize = u32(offset + 24)
            var payload = raw
            if method == 8 {
                payload = try inflate(raw, expectedSize: uncompSize)
            } else if method != 0 {
                throw TidyIOError.unreadable("Unsupported compression in .xlsx.")
            }
            entries.append(Entry(name: name, data: payload))
            offset += 46 + nameLen + extraLen + commentLen
        }
        return entries
    }

    private static func inflate(_ data: Data, expectedSize: Int) throws -> Data {
        let capacity = max(expectedSize, 64)
        var dst = Data(count: capacity)
        let written = dst.withUnsafeMutableBytes { dstPtr in
            data.withUnsafeBytes { srcPtr in
                compression_decode_buffer(
                    dstPtr.bindMemory(to: UInt8.self).baseAddress!, capacity,
                    srcPtr.bindMemory(to: UInt8.self).baseAddress!, data.count,
                    nil, COMPRESSION_ZLIB)
            }
        }
        guard written > 0 else { throw TidyIOError.unreadable("Could not decompress the .xlsx file.") }
        dst.removeSubrange(written..<dst.count)
        return dst
    }

    // ---- writing (stored entries, deterministic) ----

    private static let crcTable: [UInt32] = {
        (0..<256).map { i -> UInt32 in
            var c = UInt32(i)
            for _ in 0..<8 { c = (c & 1) == 1 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
            return c
        }
    }()

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFFFFFF
        for b in data { c = crcTable[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFFFFFF
    }

    static func write(_ entries: [Entry]) -> Data {
        var out = Data()
        var central = Data()
        var offsets: [Int] = []
        func append16(_ d: inout Data, _ v: Int) {
            d.append(UInt8(v & 0xFF)); d.append(UInt8((v >> 8) & 0xFF))
        }
        func append32(_ d: inout Data, _ v: Int) {
            d.append(UInt8(v & 0xFF)); d.append(UInt8((v >> 8) & 0xFF))
            d.append(UInt8((v >> 16) & 0xFF)); d.append(UInt8((v >> 24) & 0xFF))
        }
        for e in entries {
            offsets.append(out.count)
            let nameData = e.name.data(using: .utf8)!
            let crc = Int(crc32(e.data))
            append32(&out, 0x04034b50)
            append16(&out, 20)      // version needed
            append16(&out, 0)       // flags
            append16(&out, 0)       // method: stored
            append16(&out, 0)       // mod time
            append16(&out, 0x21)    // mod date (1980-01-01)
            append32(&out, crc)
            append32(&out, e.data.count)
            append32(&out, e.data.count)
            append16(&out, nameData.count)
            append16(&out, 0)       // extra len
            out.append(nameData)
            out.append(e.data)
        }
        for (i, e) in entries.enumerated() {
            let nameData = e.name.data(using: .utf8)!
            let crc = Int(crc32(e.data))
            append32(&central, 0x02014b50)
            append16(&central, 20)  // version made by
            append16(&central, 20)  // version needed
            append16(&central, 0)   // flags
            append16(&central, 0)   // method
            append16(&central, 0)   // time
            append16(&central, 0x21)
            append32(&central, crc)
            append32(&central, e.data.count)
            append32(&central, e.data.count)
            append16(&central, nameData.count)
            append16(&central, 0)   // extra
            append16(&central, 0)   // comment
            append16(&central, 0)   // disk
            append16(&central, 0)   // internal attrs
            append32(&central, 0)   // external attrs
            append32(&central, offsets[i])
            central.append(nameData)
        }
        let centralOffset = out.count
        out.append(central)
        var eocd = Data()
        append32(&eocd, 0x06054b50)
        append16(&eocd, 0)
        append16(&eocd, 0)
        append16(&eocd, entries.count)
        append16(&eocd, entries.count)
        append32(&eocd, central.count)
        append32(&eocd, centralOffset)
        append16(&eocd, 0)
        out.append(eocd)
        return out
    }
}

// MARK: - XLSX

enum XLSXIO {
    static func xmlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    // ---- reading ----

    private static func firstSheetPath(_ entries: [MiniZip.Entry]) -> String {
        // by convention; fall back to any sheet in xl/worksheets
        if entries.contains(where: { $0.name == "xl/worksheets/sheet1.xml" }) {
            return "xl/worksheets/sheet1.xml"
        }
        return entries.first { $0.name.hasPrefix("xl/worksheets/") && $0.name.hasSuffix(".xml") }?.name
            ?? "xl/worksheets/sheet1.xml"
    }

    private static func parseSharedStrings(_ xml: String) -> [String] {
        // Each <si> may contain one <t> or multiple runs of <r><t>. Concatenate all <t> per <si>.
        var out: [String] = []
        let siParts = xml.components(separatedBy: "<si")
        let tRe = try! NSRegularExpression(pattern: "<t[^>]*>(.*?)</t>|<t[^>]*/>",
                                           options: [.dotMatchesLineSeparators])
        for part in siParts.dropFirst() {
            guard let endRange = part.range(of: "</si>") else { continue }
            let body = String(part[..<endRange.lowerBound])
            var s = ""
            let range = NSRange(body.startIndex..., in: body)
            for m in tRe.matches(in: body, range: range) {
                if m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: body) {
                    s += String(body[r])
                }
            }
            out.append(xmlUnescape(s))
        }
        return out
    }

    static func xmlUnescape(_ s: String) -> String {
        s.replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    private static func columnIndex(fromRef ref: String) -> Int {
        var col = 0
        for ch in ref {
            guard ch.isLetter else { break }
            col = col * 26 + Int(ch.uppercased().unicodeScalars.first!.value - 64)
        }
        return max(0, col - 1)
    }

    static func read(_ data: Data) throws -> DataTable {
        let entries = try MiniZip.read(data)
        var shared: [String] = []
        if let ss = entries.first(where: { $0.name == "xl/sharedStrings.xml" }),
           let xml = String(data: ss.data, encoding: .utf8) {
            shared = parseSharedStrings(xml)
        }
        let sheetPath = firstSheetPath(entries)
        guard let sheet = entries.first(where: { $0.name == sheetPath }),
              let xml = String(data: sheet.data, encoding: .utf8) else {
            throw TidyIOError.unreadable("No worksheet found in the .xlsx file.")
        }
        // rows
        var rows: [[Cell]] = []
        let rowRe = try! NSRegularExpression(pattern: "<row[^>]*>(.*?)</row>",
                                             options: [.dotMatchesLineSeparators])
        let cellRe = try! NSRegularExpression(
            pattern: "<c([^>]*?)(?:/>|>(.*?)</c>)",
            options: [.dotMatchesLineSeparators])
        let vRe = try! NSRegularExpression(pattern: "<v[^>]*>(.*?)</v>", options: [.dotMatchesLineSeparators])
        let tInlineRe = try! NSRegularExpression(pattern: "<t[^>]*>(.*?)</t>", options: [.dotMatchesLineSeparators])
        let refRe = try! NSRegularExpression(pattern: "r=\"([A-Z]+)\\d+\"")
        let typeRe = try! NSRegularExpression(pattern: "t=\"([a-zA-Z]+)\"")

        let xmlRange = NSRange(xml.startIndex..., in: xml)
        for rowMatch in rowRe.matches(in: xml, range: xmlRange) {
            guard let rowRange = Range(rowMatch.range(at: 1), in: xml) else { continue }
            let rowXML = String(xml[rowRange])
            var cells: [Cell] = []
            let rr = NSRange(rowXML.startIndex..., in: rowXML)
            for cm in cellRe.matches(in: rowXML, range: rr) {
                guard let attrsRange = Range(cm.range(at: 1), in: rowXML) else { continue }
                let attrs = String(rowXML[attrsRange])
                let body: String
                if cm.numberOfRanges > 2, cm.range(at: 2).location != NSNotFound,
                   let bodyRange = Range(cm.range(at: 2), in: rowXML) {
                    body = String(rowXML[bodyRange])
                } else {
                    body = ""
                }
                // place at referenced column index, padding gaps with nulls
                var colIdx = cells.count
                let ar = NSRange(attrs.startIndex..., in: attrs)
                if let rm = refRe.firstMatch(in: attrs, range: ar),
                   let r = Range(rm.range(at: 1), in: attrs) {
                    colIdx = columnIndex(fromRef: String(attrs[r]))
                }
                while cells.count < colIdx { cells.append(.null) }
                var cellType = ""
                if let tm = typeRe.firstMatch(in: attrs, range: ar),
                   let r = Range(tm.range(at: 1), in: attrs) {
                    cellType = String(attrs[r])
                }
                var value: Cell = .null
                let br = NSRange(body.startIndex..., in: body)
                if cellType == "inlineStr" {
                    if let m = tInlineRe.firstMatch(in: body, range: br),
                       let r = Range(m.range(at: 1), in: body) {
                        value = .text(xmlUnescape(String(body[r])))
                    }
                } else if let m = vRe.firstMatch(in: body, range: br),
                          let r = Range(m.range(at: 1), in: body) {
                    let raw = xmlUnescape(String(body[r]))
                    switch cellType {
                    case "s":
                        let idx = Int(raw) ?? -1
                        value = idx >= 0 && idx < shared.count ? .text(shared[idx]) : .null
                    case "b":
                        value = .bool(raw == "1")
                    case "str":
                        value = .text(raw)
                    default:
                        // raw:false parity with the web app: numbers arrive as text
                        value = .text(raw)
                    }
                }
                if cells.count == colIdx { cells.append(value) } else { cells[colIdx] = value }
            }
            rows.append(cells)
        }
        guard !rows.isEmpty else { return .empty }
        let width = rows.map(\.count).max() ?? 0
        let header = (0..<width).map { i -> String in
            i < rows[0].count ? rows[0][i].s : ""
        }
        let body = rows.dropFirst().map { r -> [Cell] in
            (0..<width).map { i in i < r.count ? r[i] : .null }
        }
        return Dataframe.tableFromRows(header: header, rows: Array(body))
    }

    // ---- writing ----

    static func write(_ t: DataTable) -> Data {
        let (header, rows) = Dataframe.tableToRows(t)

        func cellRef(_ col: Int, _ row: Int) -> String {
            var c = col + 1
            var name = ""
            while c > 0 {
                let rem = (c - 1) % 26
                name = String(UnicodeScalar(UInt8(65 + rem))) + name
                c = (c - 1) / 26
            }
            return "\(name)\(row + 1)"
        }

        var sheet = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        sheet += "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>"
        func rowXML(_ cells: [Cell], rowIdx: Int) -> String {
            var xml = "<row r=\"\(rowIdx + 1)\">"
            for (ci, cell) in cells.enumerated() {
                if case .null = cell { continue }
                let ref = cellRef(ci, rowIdx)
                switch cell {
                case .number(let n) where n.isFinite:
                    xml += "<c r=\"\(ref)\"><v>\(Cell.renderNumber(n))</v></c>"
                case .bool(let b):
                    xml += "<c r=\"\(ref)\" t=\"b\"><v>\(b ? 1 : 0)</v></c>"
                default:
                    xml += "<c r=\"\(ref)\" t=\"inlineStr\"><is><t xml:space=\"preserve\">\(xmlEscape(cell.s))</t></is></c>"
                }
            }
            return xml + "</row>"
        }
        sheet += rowXML(header.map { .text($0) }, rowIdx: 0)
        for (ri, r) in rows.enumerated() {
            sheet += rowXML(r, rowIdx: ri + 1)
        }
        sheet += "</sheetData></worksheet>"

        let contentTypes = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>
        """
        let rootRels = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>
        """
        let workbook = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tidyset" sheetId="1" r:id="rId1"/></sheets></workbook>
        """
        let workbookRels = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>
        """
        return MiniZip.write([
            MiniZip.Entry(name: "[Content_Types].xml", data: contentTypes.data(using: .utf8)!),
            MiniZip.Entry(name: "_rels/.rels", data: rootRels.data(using: .utf8)!),
            MiniZip.Entry(name: "xl/workbook.xml", data: workbook.data(using: .utf8)!),
            MiniZip.Entry(name: "xl/_rels/workbook.xml.rels", data: workbookRels.data(using: .utf8)!),
            MiniZip.Entry(name: "xl/worksheets/sheet1.xml", data: sheet.data(using: .utf8)!)
        ])
    }
}

// MARK: - Top-level import/export (io.ts)

enum TidyIO {
    static func parse(name: String, data: Data) throws -> DataTable {
        let fmt = ImportFormat.detect(from: name)
        switch fmt {
        case .xlsx:
            return try XLSXIO.read(data)
        case .json:
            guard let obj = try? JSONSerialization.jsonObject(with: data) else {
                throw TidyIOError.unreadable("This JSON file could not be parsed.")
            }
            let arr: [Any] = obj as? [Any] ?? [obj]
            var header: [String] = []
            var seen = Set<String>()
            for row in arr {
                guard let dict = row as? [String: Any] else { continue }
                for k in dict.keys where !seen.contains(k) {
                    seen.insert(k)
                    header.append(k)
                }
            }
            let body: [[Cell]] = arr.map { row in
                let dict = row as? [String: Any] ?? [:]
                return header.map { k -> Cell in
                    guard let v = dict[k], !(v is NSNull) else { return .null }
                    if let b = v as? Bool { return .bool(b) }
                    if let n = v as? NSNumber { return .number(n.doubleValue) }
                    if let s = v as? String { return .text(s) }
                    return .text(String(describing: v))
                }
            }
            return Dataframe.tableFromRows(header: header, rows: body)
        case .csv, .tsv:
            guard let text = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1) else {
                throw TidyIOError.unreadable("This file is not text I can decode.")
            }
            let delimiter: Character = fmt == .tsv ? "\t" : ","
            let rows = CSV.parse(text, delimiter: delimiter)
            guard !rows.isEmpty else { return .empty }
            let header = rows[0]
            let body = rows.dropFirst().map { r in r.map { Cell.text($0) } }
            return Dataframe.tableFromRows(header: header, rows: Array(body))
        }
    }

    static func toCSV(_ t: DataTable, delimiter: Character = ",") -> String {
        let (header, rows) = Dataframe.tableToRows(t)
        return CSV.unparse(header: header, rows: rows, delimiter: delimiter)
    }

    static func toJSON(_ t: DataTable) -> String {
        let (header, rows) = Dataframe.tableToRows(t)
        var objs: [[String: Any]] = []
        for r in rows {
            var o: [String: Any] = [:]
            for (i, h) in header.enumerated() {
                switch r[i] {
                case .null: o[h] = NSNull()
                case .text(let s): o[h] = s
                case .number(let n): o[h] = n
                case .bool(let b): o[h] = b
                }
            }
            objs.append(o)
        }
        let data = (try? JSONSerialization.data(withJSONObject: objs,
                                                options: [.prettyPrinted, .sortedKeys])) ?? Data()
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    static func toXLSX(_ t: DataTable) -> Data {
        XLSXIO.write(t)
    }

    // Recipe files (.tidyset)
    static func encodeRecipe(_ recipe: Recipe) -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? enc.encode(recipe)) ?? Data()
    }

    static func decodeRecipe(_ data: Data) throws -> Recipe {
        try JSONDecoder().decode(Recipe.self, from: data)
    }
}
