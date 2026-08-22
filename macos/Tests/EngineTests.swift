// Engine parity tests — ported from the web app's src/engine/engine.test.ts.
import XCTest

final class EngineTests: XCTestCase {

    func col(_ name: String, _ values: [String?], type: ColType = .text) -> Column {
        Column(id: name, name: name, type: type,
               values: values.map { $0.map { .text($0) } ?? .null })
    }

    // MARK: dates

    func testNormalizeDateVariants() {
        XCTAssertEqual(Dataframe.normalizeDate("2024-01-31"), "2024-01-31")
        XCTAssertEqual(Dataframe.normalizeDate("2024/1/9"), "2024-01-09")
        XCTAssertEqual(Dataframe.normalizeDate("31/01/2024"), "2024-01-31")
        XCTAssertEqual(Dataframe.normalizeDate("15.02.2024"), "2024-02-15")
        XCTAssertEqual(Dataframe.normalizeDate("Mar 3, 2024"), "2024-03-03")
        XCTAssertEqual(Dataframe.normalizeDate("11 Apr 2024"), "2024-04-11")
        XCTAssertNil(Dataframe.normalizeDate("not a date"))
        XCTAssertNil(Dataframe.normalizeDate("99/99/2024"))
    }

    // MARK: type detection

    func testDetectType() {
        XCTAssertEqual(Dataframe.detectType([.text("1"), .text("2"), .text("300")]), .integer)
        XCTAssertEqual(Dataframe.detectType([.text("1.5"), .text("2.25"), .text("3")]), .decimal)
        XCTAssertEqual(Dataframe.detectType([.text("yes"), .text("no"), .text("yes")]), .boolean)
        XCTAssertEqual(Dataframe.detectType([.text("2024-01-01"), .text("15/02/2024"), .text("Mar 3, 2024")]), .date)
        XCTAssertEqual(Dataframe.detectType([.text("alpha"), .text("beta")]), .text)
        // comma-grouped numbers fail the integer regex but pass the decimal one
        XCTAssertEqual(Dataframe.detectType([.text("1,200"), .text("4,800"), .text("299")]), .decimal)
    }

    // MARK: transforms

    func testTrimCollapsesWhitespace() {
        let t = DataTable(columns: [col("A", ["  x  y  ", "ok", nil])], nrows: 3)
        let op = TidyOp(id: "1", type: .trim, label: "", enabled: true,
                        params: ["columns": .stringList(["A"])])
        let out = Transforms.apply(t, op)
        XCTAssertEqual(out.columns[0].values[0], .text("x y"))
        XCTAssertEqual(out.columns[0].values[1], .text("ok"))
        XCTAssertEqual(out.columns[0].values[2], .null)
    }

    func testDedupeRows() {
        let t = DataTable(columns: [col("A", ["a", "b", "a"]), col("B", ["1", "2", "1"])], nrows: 3)
        let op = TidyOp(id: "1", type: .dedupeRows, label: "", enabled: true, params: [:])
        let out = Transforms.apply(t, op)
        XCTAssertEqual(out.nrows, 2)
    }

    func testFilterRows() {
        let t = DataTable(columns: [col("N", ["10", "25", "3"], type: .integer)], nrows: 3)
        let op = TidyOp(id: "1", type: .filterRows, label: "", enabled: true,
                        params: ["column": .string("N"), "op": .string("gt"), "value": .string("9")])
        let out = Transforms.apply(t, op)
        XCTAssertEqual(out.nrows, 2)
    }

    func testSplitAndMerge() {
        let t = DataTable(columns: [col("Full", ["a-b", "c-d"])], nrows: 2)
        let split = TidyOp(id: "1", type: .splitColumn, label: "", enabled: true,
                           params: ["column": .string("Full"), "delimiter": .string("-")])
        let out = Transforms.apply(t, split)
        XCTAssertEqual(out.columns.map(\.name), ["Full_1", "Full_2"])
        XCTAssertEqual(out.columns[1].values[1], .text("d"))
    }

    func testFillDown() {
        let t = DataTable(columns: [col("A", ["x", nil, nil, "y", nil])], nrows: 5)
        let op = TidyOp(id: "1", type: .fillDown, label: "", enabled: true,
                        params: ["columns": .stringList(["A"])])
        let out = Transforms.apply(t, op)
        XCTAssertEqual(out.columns[0].values.map(\.s), ["x", "x", "x", "y", "y"])
    }

    func testFuzzyDedupeMergesNearDuplicates() {
        let t = DataTable(columns: [col("Name", ["Katherine Johnson", "katherine johnson", "Linus Torvalds"])],
                          nrows: 3)
        let op = TidyOp(id: "1", type: .fuzzyDedupe, label: "", enabled: true,
                        params: ["columns": .stringList(["Name"]), "threshold": .number(0.9),
                                 "survivorship": .string("first")])
        let out = Transforms.apply(t, op)
        XCTAssertEqual(out.nrows, 2)
        XCTAssertEqual(out.columns[0].values[0], .text("Katherine Johnson"))
    }

    // MARK: algorithms

    func testJaroWinkler() {
        XCTAssertEqual(Algorithms.jaroWinkler("abc", "abc"), 1)
        XCTAssertEqual(Algorithms.jaroWinkler("", "abc"), 0)
        XCTAssertGreaterThan(Algorithms.jaroWinkler("martha", "marhta"), 0.94)
        XCTAssertGreaterThan(Algorithms.jaroWinkler("united states", "united  states".lowercased()), 0.9)
    }

    func testLevenshtein() {
        XCTAssertEqual(Algorithms.levenshtein("kitten", "sitting"), 3)
        XCTAssertEqual(Algorithms.levenshtein("", "abc"), 3)
        XCTAssertEqual(Algorithms.levenshtein("same", "same"), 0)
    }

    func testFingerprintClusters() {
        let distinct = [
            Algorithms.ClusterMember(value: "United States", count: 5),
            Algorithms.ClusterMember(value: "united  states", count: 2),
            Algorithms.ClusterMember(value: "Finland", count: 1)
        ]
        let clusters = Algorithms.buildClusters(distinct, method: .fingerprint)
        XCTAssertEqual(clusters.count, 1)
        XCTAssertEqual(clusters[0].suggestion, "United States")
        XCTAssertEqual(clusters[0].total, 7)
    }

    // MARK: phone / name parsing

    func testNormalizePhone() {
        XCTAssertEqual(FieldParsers.normalizePhone("(415) 555-0100"), "+14155550100")
        XCTAssertEqual(FieldParsers.normalizePhone("+44 20 7946 0000"), "+442079460000")
        XCTAssertEqual(FieldParsers.normalizePhone("0044 20 7946 0000"), "+442079460000")
        XCTAssertNil(FieldParsers.normalizePhone("no digits"))
    }

    func testParseName() {
        XCTAssertEqual(FieldParsers.parseName("Ada Lovelace").first, "Ada")
        XCTAssertEqual(FieldParsers.parseName("Ada Lovelace").last, "Lovelace")
        XCTAssertEqual(FieldParsers.parseName("Lovelace, Ada").first, "Ada")
        XCTAssertEqual(FieldParsers.parseName("Cher").last, "")
    }

    // MARK: expression language

    func testExpressions() throws {
        func run(_ src: String, value: Cell = .null, row: [String: Cell] = [:]) throws -> Cell {
            let compiled = try Expression.compile(src)
            return compiled.eval(Expression.Context(value: value, row: row))
        }
        XCTAssertEqual(try run("upper(trim(value))", value: .text("  hi ")), .text("HI"))
        XCTAssertEqual(try run("concat($First, \" \", $Last)",
                               row: ["First": .text("Ada"), "Last": .text("Lovelace")]),
                       .text("Ada Lovelace"))
        XCTAssertEqual(try run("if(len(value) > 5, \"long\", \"short\")", value: .text("abcdef")), .text("long"))
        XCTAssertEqual(try run("part(value, \"@\", 1)", value: .text("a@b.com")), .text("b.com"))
        XCTAssertEqual(try run("round(3.14159, 2)"), .number(3.14))
        XCTAssertEqual(try run("2 + 3 * 4"), .number(14))
        XCTAssertEqual(try run("coalesce(null, \"\", \"x\")"), .text("x"))
        XCTAssertNotNil(Expression.check("upper("))
        XCTAssertNil(Expression.check("upper(value)"))
    }

    // MARK: CSV

    func testCSVRoundTrip() {
        let text = "a,b\n\"1,5\",\"say \"\"hi\"\"\"\n2,plain"
        let rows = CSV.parse(text)
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[1], ["1,5", "say \"hi\""])
        let t = Dataframe.tableFromRows(header: rows[0],
                                        rows: rows.dropFirst().map { $0.map { Cell.text($0) } })
        let out = TidyIO.toCSV(t)
        XCTAssertTrue(out.contains("\"1,5\""))
        XCTAssertTrue(out.contains("\"say \"\"hi\"\"\""))
    }

    // MARK: XLSX

    func testXLSXRoundTrip() throws {
        let t = DataTable(columns: [
            col("Name", ["Ada", "Grace & \u{201C}co\u{201D}", nil]),
            Column(id: "n", name: "N", type: .integer,
                   values: [.number(1), .number(2), .number(1200)])
        ], nrows: 3)
        let data = TidyIO.toXLSX(t)
        XCTAssertGreaterThan(data.count, 200)
        let back = try XLSXIO.read(data)
        XCTAssertEqual(back.columns.map(\.name), ["Name", "N"])
        XCTAssertEqual(back.nrows, 3)
        XCTAssertEqual(back.columns[0].values[1].s, "Grace & \u{201C}co\u{201D}")
        XCTAssertEqual(back.columns[1].values[2].s, "1200")
    }

    // MARK: quality + suggestions + pipeline on the sample

    func testSamplePipeline() {
        let sample = SampleData.table()
        XCTAssertEqual(sample.nrows, 15)
        let q = QualityScorer.datasetQuality(sample)
        XCTAssertLessThan(q.score, 90)
        // the near-duplicate rows only become exact duplicates after trimming
        XCTAssertEqual(q.duplicateRows, 0)

        let suggestions = Suggest.fixes(sample)
        XCTAssertTrue(suggestions.contains { $0.opType == .trim })

        var ops: [TidyOp] = suggestions.map {
            TidyOp(id: $0.id, type: $0.opType, label: $0.title, enabled: true, params: $0.params)
        }
        ops.append(TidyOp(id: "d", type: .standardizeDate, label: "", enabled: true,
                          params: ["column": .string("Signup Date")]))
        ops.append(TidyOp(id: "dd", type: .dedupeRows, label: "", enabled: true, params: [:]))
        let cleaned = Pipeline.fold(sample, ops)
        XCTAssertLessThan(cleaned.nrows, sample.nrows)
        let q2 = QualityScorer.datasetQuality(cleaned)
        XCTAssertGreaterThan(q2.score, q.score)
    }

    func testStepDeltaAndSnapshots() {
        let sample = SampleData.table()
        let allCols = ParamValue.stringList(sample.columns.map(\.name))
        let ops = [TidyOp(id: "0", type: .trim, label: "", enabled: true, params: ["columns": allCols]),
                   TidyOp(id: "1", type: .removeEmptyRows, label: "", enabled: true, params: [:]),
                   TidyOp(id: "2", type: .dedupeRows, label: "", enabled: true, params: [:])]
        let snaps = Pipeline.foldAll(sample, ops)
        XCTAssertEqual(snaps.count, 4)
        let d = Pipeline.stepDelta(snaps[2], snaps[3])
        XCTAssertLessThan(d.rows, 0)
    }

    func testRecipeRoundTrip() throws {
        let ops = [TidyOp(id: "1", type: .trim, label: "Trim", enabled: true,
                          params: ["columns": .stringList(["A", "B"])]),
                   TidyOp(id: "2", type: .clusterMerge, label: "Merge", enabled: false,
                          params: ["column": .string("A"),
                                   "mapping": .mapping(["usa": "United States"])])]
        let recipe = Recipe(name: "test", createdAt: "2026-07-22T00:00:00Z", ops: ops)
        let data = TidyIO.encodeRecipe(recipe)
        let back = try TidyIO.decodeRecipe(data)
        XCTAssertEqual(back.ops.count, 2)
        XCTAssertEqual(back.ops[0].list("columns"), ["A", "B"])
        XCTAssertEqual(back.ops[1].params["mapping"]?.mappingValue?["usa"], "United States")
        XCTAssertFalse(back.ops[1].enabled)
    }
}
