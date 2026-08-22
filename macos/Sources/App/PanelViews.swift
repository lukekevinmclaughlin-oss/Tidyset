// Recipe panel, suggestions, inspector, add-step forms and the cluster tool.
import SwiftUI

// MARK: - Recipe + suggestions (left panel)

struct RecipePanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    suggestionsSection
                    recipeSection
                }
                .padding(12)
            }
        }
        .panelCard()
    }

    private var suggestionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Suggestions", systemImage: "wand.and.stars")
                .font(.subheadline.weight(.semibold))
            if model.suggestions.isEmpty {
                Text("Nothing to fix — this data looks tidy.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(model.suggestions) { s in
                Button {
                    model.applySuggestion(s)
                } label: {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: s.symbol)
                            .foregroundStyle(Theme.accent)
                            .frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.title).font(.callout.weight(.medium))
                                .multilineTextAlignment(.leading)
                            Text(s.detail).font(.caption).foregroundStyle(.secondary)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(Theme.accent.opacity(0.8))
                    }
                    .padding(8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(Theme.accentDim.opacity(0.4), in: RoundedRectangle(cornerRadius: 9))
            }
        }
    }

    private var recipeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Recipe", systemImage: "list.number")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if !model.ops.isEmpty {
                    Button("Clear") { model.clearRecipe() }
                        .buttonStyle(.plain)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if model.ops.isEmpty {
                Text("Steps you apply appear here, in order. The recipe is your undo history and your export-to-reuse file, in one.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(model.ops.enumerated()), id: \.element.id) { index, op in
                HStack(alignment: .top, spacing: 8) {
                    Text("\(index + 1)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 16)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(op.label)
                            .font(.callout)
                            .strikethrough(!op.enabled)
                            .foregroundStyle(op.enabled ? .primary : .secondary)
                        if let d = model.delta(forOpAt: index) {
                            Text(deltaText(d))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    Toggle("", isOn: Binding(
                        get: { op.enabled },
                        set: { _ in model.toggleOp(op.id) }))
                        .toggleStyle(.switch)
                        .controlSize(.mini)
                        .labelsHidden()
                    Button {
                        model.removeOp(op.id)
                    } label: {
                        Image(systemName: "trash")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(8)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 9))
            }
        }
    }

    private func deltaText(_ d: Pipeline.StepDelta) -> String {
        var parts: [String] = []
        if d.rows != 0 { parts.append("\(d.rows > 0 ? "+" : "")\(d.rows) rows") }
        if d.addedCols > 0 { parts.append("+\(d.addedCols) cols") }
        if d.removedCols > 0 { parts.append("−\(d.removedCols) cols") }
        if d.cells > 0 { parts.append("\(d.cells) cells changed") }
        return parts.isEmpty ? "no visible change" : parts.joined(separator: " · ")
    }
}

// MARK: - Inspector (right panel)

struct InspectorPanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                columnPicker
                if let name = model.selectedColumn,
                   let profile = Stats.columnProfile(model.current, name: name) {
                    profileSection(profile)
                    if model.current.column(named: name)?.type == .text {
                        Button {
                            model.showClusters = true
                        } label: {
                            Label("Cluster & merge values…", systemImage: "square.stack.3d.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                qualitySection
            }
            .padding(12)
        }
        .panelCard()
    }

    private var columnPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Inspector", systemImage: "chart.bar.doc.horizontal")
                .font(.subheadline.weight(.semibold))
            Picker("Column", selection: Binding(
                get: { model.selectedColumn ?? "" },
                set: { model.selectedColumn = $0.isEmpty ? nil : $0 })) {
                ForEach(model.current.columns, id: \.id) { c in
                    Text(c.name).tag(c.name)
                }
            }
            .labelsHidden()
        }
    }

    @ViewBuilder
    private func profileSection(_ p: ColumnProfileResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statTile("Filled", "\(p.filled)")
                statTile("Blank", "\(p.blank)")
                statTile("Distinct", "\(p.distinct)")
            }
            if let n = p.numeric {
                VStack(alignment: .leading, spacing: 3) {
                    statRow("Min", Cell.renderNumber(n.min))
                    statRow("Max", Cell.renderNumber(n.max))
                    statRow("Mean", String(format: "%.2f", n.mean))
                    statRow("Median", Cell.renderNumber(n.median))
                    statRow("Sum", Cell.renderNumber(n.sum))
                    statRow("Std dev", String(format: "%.2f", n.std))
                }
                if let bins = p.histogramBins, bins.max() ?? 0 > 0 {
                    histogramView(bins)
                }
            }
            if let mn = p.dateMin, let mx = p.dateMax {
                statRow("Earliest", mn)
                statRow("Latest", mx)
            }
            if let minL = p.textMinLen, let maxL = p.textMaxLen, let avgL = p.textAvgLen {
                statRow("Length", "\(minL)–\(maxL) chars, avg \(String(format: "%.1f", avgL))")
            }
        }
        .padding(10)
        .panelCard()
    }

    private func histogramView(_ bins: [Int]) -> some View {
        let maxBin = max(1, bins.max() ?? 1)
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(bins.enumerated()), id: \.offset) { _, b in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Theme.accent.opacity(0.8))
                    .frame(height: max(2, CGFloat(b) / CGFloat(maxBin) * 46))
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 50)
    }

    private func statTile(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.callout.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }

    private func statRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.caption.monospacedDigit())
        }
    }

    private var qualitySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Column health", systemImage: "heart.text.square")
                .font(.subheadline.weight(.semibold))
            ForEach(model.quality.columns) { c in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(c.name).font(.caption.weight(.medium)).lineLimit(1)
                        Spacer()
                        Text("\(Int((c.completeness * 100).rounded()))%")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.08))
                            Capsule()
                                .fill(Theme.scoreColor(Int(c.completeness * 100)))
                                .frame(width: max(3, geo.size.width * c.completeness))
                        }
                    }
                    .frame(height: 4)
                    if !c.issues.isEmpty {
                        Text(c.issues.joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle(Theme.warn)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }
}

// MARK: - Add-step sheet

struct AddStepSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    enum StepKind: String, CaseIterable, Identifiable {
        case trim = "Trim whitespace"
        case changeCase = "Change case"
        case replace = "Find & replace"
        case splitColumn = "Split column"
        case mergeColumns = "Merge columns"
        case renameColumn = "Rename column"
        case deleteColumns = "Delete columns"
        case changeType = "Change type"
        case filterRows = "Filter rows"
        case removeEmpty = "Remove empty rows & columns"
        case fillMissing = "Fill missing values"
        case dedupeRows = "Remove duplicate rows"
        case fuzzyDedupe = "Fuzzy de-duplicate"
        case standardizeDate = "Standardise dates"
        case parseField = "Parse phone / name"
        case numberFormat = "Round numbers"
        case expression = "Custom formula"
        var id: String { rawValue }
    }

    @State private var kind: StepKind = .trim
    @State private var selectedColumns: Set<String> = []
    @State private var column = ""
    @State private var caseMode = "title"
    @State private var findText = ""
    @State private var replaceText = ""
    @State private var caseInsensitive = false
    @State private var useRegex = false
    @State private var delimiter = ","
    @State private var keepOriginal = false
    @State private var mergeSeparator = " "
    @State private var newName = ""
    @State private var targetType: ColType = .text
    @State private var filterOp = "contains"
    @State private var filterValue = ""
    @State private var fillStrategy: FillStrategy = .down
    @State private var fillConstant = ""
    @State private var fuzzyThreshold = 0.9
    @State private var survivorship = "first"
    @State private var parseKind = "phone"
    @State private var namePart = "first"
    @State private var phoneCountry = "1"
    @State private var decimals = 2.0
    @State private var expr = ""
    @State private var exprName = ""

    private var columnNames: [String] { model.current.columns.map(\.name) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add a cleaning step").font(.title3.bold())
            Picker("Step", selection: $kind) {
                ForEach(StepKind.allCases) { k in Text(k.rawValue).tag(k) }
            }
            form
            if kind == .expression, !expr.isEmpty, let err = Expression.check(expr) {
                Text(err).font(.caption).foregroundStyle(Theme.bad)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Add Step") { add(); dismiss() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(!isValid)
            }
        }
        .padding(20)
        .frame(width: 460)
        .onAppear {
            column = model.selectedColumn ?? columnNames.first ?? ""
            if let sel = model.selectedColumn { selectedColumns = [sel] }
        }
    }

    @ViewBuilder
    private var form: some View {
        switch kind {
        case .trim, .changeCase, .mergeColumns, .deleteColumns, .fuzzyDedupe, .dedupeRows:
            columnMultiPicker
            if kind == .changeCase {
                Picker("Case", selection: $caseMode) {
                    Text("Title Case").tag("title")
                    Text("UPPERCASE").tag("upper")
                    Text("lowercase").tag("lower")
                }
            }
            if kind == .mergeColumns {
                TextField("New column name", text: $newName)
                TextField("Separator", text: $mergeSeparator)
            }
            if kind == .fuzzyDedupe {
                VStack(alignment: .leading) {
                    Slider(value: $fuzzyThreshold, in: 0.7...0.99) {
                        Text("Similarity \(String(format: "%.2f", fuzzyThreshold))")
                    }
                    Picker("Keep", selection: $survivorship) {
                        Text("First seen").tag("first")
                        Text("Longest").tag("longest")
                        Text("Most complete").tag("mostComplete")
                    }
                }
            }
        case .replace:
            columnMultiPicker
            TextField("Find", text: $findText)
            TextField("Replace with", text: $replaceText)
            Toggle("Ignore case", isOn: $caseInsensitive)
            Toggle("Regular expression", isOn: $useRegex)
        case .splitColumn:
            singleColumnPicker
            TextField("Delimiter", text: $delimiter)
            Toggle("Keep original column", isOn: $keepOriginal)
        case .renameColumn:
            singleColumnPicker
            TextField("New name", text: $newName)
        case .changeType:
            singleColumnPicker
            Picker("Type", selection: $targetType) {
                ForEach(ColType.allCases, id: \.self) { t in Text(t.label).tag(t) }
            }
        case .filterRows:
            singleColumnPicker
            Picker("Condition", selection: $filterOp) {
                Text("contains").tag("contains")
                Text("does not contain").tag("notContains")
                Text("equals").tag("eq")
                Text("does not equal").tag("neq")
                Text("greater than").tag("gt")
                Text("less than").tag("lt")
                Text("is empty").tag("empty")
                Text("is not empty").tag("notEmpty")
            }
            if filterOp != "empty" && filterOp != "notEmpty" {
                TextField("Value", text: $filterValue)
            }
        case .removeEmpty:
            Text("Removes rows and columns that contain no values at all.")
                .font(.caption).foregroundStyle(.secondary)
        case .fillMissing:
            singleColumnPicker
            Picker("Strategy", selection: $fillStrategy) {
                Text("Fill down").tag(FillStrategy.down)
                Text("Fill up").tag(FillStrategy.up)
                Text("Constant").tag(FillStrategy.constant)
                Text("Mean").tag(FillStrategy.mean)
                Text("Median").tag(FillStrategy.median)
                Text("Most frequent").tag(FillStrategy.mode)
            }
            if fillStrategy == .constant {
                TextField("Fill value", text: $fillConstant)
            }
        case .standardizeDate:
            singleColumnPicker
            Text("Converts recognised date formats to ISO (YYYY-MM-DD).")
                .font(.caption).foregroundStyle(.secondary)
        case .parseField:
            singleColumnPicker
            Picker("Parse as", selection: $parseKind) {
                Text("Phone number").tag("phone")
                Text("Person name").tag("name")
            }
            if parseKind == "name" {
                Picker("Keep part", selection: $namePart) {
                    Text("First name").tag("first")
                    Text("Last name").tag("last")
                }
            } else {
                TextField("Default country code", text: $phoneCountry)
            }
            TextField("Into new column (optional)", text: $newName)
        case .numberFormat:
            singleColumnPicker
            Stepper("Decimals: \(Int(decimals))", value: $decimals, in: 0...6)
        case .expression:
            TextField("Formula, e.g. upper(trim(value))", text: $expr)
                .font(.body.monospaced())
            Picker("Apply to", selection: $column) {
                ForEach(columnNames, id: \.self) { Text("Replace \($0)").tag($0) }
            }
            TextField("Or create new column named", text: $exprName)
            Text("Functions: upper lower trim title len replace concat part if coalesce round number regexReplace… Use value for the current cell, $Column for others.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private var columnMultiPicker: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(kind == .dedupeRows || kind == .fuzzyDedupe
                 ? "Match on columns (none = all)" : "Columns")
                .font(.caption).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(columnNames, id: \.self) { name in
                        Toggle(name, isOn: Binding(
                            get: { selectedColumns.contains(name) },
                            set: { on in
                                if on { selectedColumns.insert(name) }
                                else { selectedColumns.remove(name) }
                            }))
                            .toggleStyle(.checkbox)
                            .font(.callout)
                    }
                }
            }
            .frame(maxHeight: 110)
        }
    }

    private var singleColumnPicker: some View {
        Picker("Column", selection: $column) {
            ForEach(columnNames, id: \.self) { Text($0).tag($0) }
        }
    }

    private var isValid: Bool {
        switch kind {
        case .trim, .changeCase, .mergeColumns, .deleteColumns:
            return !selectedColumns.isEmpty
        case .replace:
            return !selectedColumns.isEmpty && !findText.isEmpty
        case .splitColumn:
            return !column.isEmpty && !delimiter.isEmpty
        case .renameColumn:
            return !column.isEmpty && !newName.isEmpty
        case .expression:
            return !expr.isEmpty && Expression.check(expr) == nil
        case .filterRows:
            return !column.isEmpty
        default:
            return true
        }
    }

    private func add() {
        let cols = ParamValue.stringList(Array(selectedColumns).sorted {
            (columnNames.firstIndex(of: $0) ?? 0) < (columnNames.firstIndex(of: $1) ?? 0)
        })
        switch kind {
        case .trim:
            model.addOp(.trim, label: "Trim whitespace", params: ["columns": cols])
        case .changeCase:
            let label = caseMode == "upper" ? "UPPERCASE" : caseMode == "lower" ? "lowercase" : "Title Case"
            model.addOp(.changeCase, label: "Change case to \(label)",
                        params: ["columns": cols, "mode": .string(caseMode)])
        case .replace:
            model.addOp(.replace, label: "Replace \u{201C}\(findText)\u{201D} \u{2192} \u{201C}\(replaceText)\u{201D}",
                        params: ["columns": cols, "find": .string(findText),
                                 "replaceWith": .string(replaceText),
                                 "caseInsensitive": .bool(caseInsensitive),
                                 "regex": .bool(useRegex)])
        case .splitColumn:
            model.addOp(.splitColumn, label: "Split \u{201C}\(column)\u{201D} on \u{201C}\(delimiter)\u{201D}",
                        params: ["column": .string(column), "delimiter": .string(delimiter),
                                 "keepOriginal": .bool(keepOriginal)])
        case .mergeColumns:
            model.addOp(.mergeColumns, label: "Merge \(selectedColumns.count) columns",
                        params: ["columns": cols, "separator": .string(mergeSeparator),
                                 "name": .string(newName)])
        case .renameColumn:
            model.addOp(.renameColumn, label: "Rename \u{201C}\(column)\u{201D} \u{2192} \u{201C}\(newName)\u{201D}",
                        params: ["column": .string(column), "name": .string(newName)])
        case .deleteColumns:
            model.addOp(.deleteColumns, label: "Delete \(selectedColumns.count) column\(selectedColumns.count == 1 ? "" : "s")",
                        params: ["columns": cols])
        case .changeType:
            model.addOp(.changeType, label: "Type of \u{201C}\(column)\u{201D} \u{2192} \(targetType.label)",
                        params: ["column": .string(column), "type": .string(targetType.rawValue)])
        case .filterRows:
            model.addOp(.filterRows, label: "Filter \u{201C}\(column)\u{201D} \(filterOp) \(filterValue)",
                        params: ["column": .string(column), "op": .string(filterOp),
                                 "value": .string(filterValue)])
        case .removeEmpty:
            model.addOp(.removeEmptyRows, label: "Remove empty rows", params: [:])
            model.addOp(.removeEmptyColumns, label: "Remove empty columns", params: [:])
        case .fillMissing:
            model.addOp(.fillMissing, label: "Fill blanks in \u{201C}\(column)\u{201D} (\(fillStrategy.rawValue))",
                        params: ["column": .string(column),
                                 "strategy": .string(fillStrategy.rawValue),
                                 "value": .string(fillConstant)])
        case .dedupeRows:
            model.addOp(.dedupeRows, label: "Remove duplicate rows", params: ["columns": cols])
        case .fuzzyDedupe:
            model.addOp(.fuzzyDedupe, label: "Fuzzy de-duplicate (\u{2265}\(String(format: "%.2f", fuzzyThreshold)))",
                        params: ["columns": cols, "threshold": .number(fuzzyThreshold),
                                 "survivorship": .string(survivorship)])
        case .standardizeDate:
            model.addOp(.standardizeDate, label: "Standardise dates in \u{201C}\(column)\u{201D}",
                        params: ["column": .string(column)])
        case .parseField:
            let what = parseKind == "phone" ? "phone numbers" : "\(namePart) names"
            model.addOp(.parseField, label: "Parse \(what) in \u{201C}\(column)\u{201D}",
                        params: ["column": .string(column), "kind": .string(parseKind),
                                 "part": .string(namePart), "country": .string(phoneCountry),
                                 "into": .string(newName)])
        case .numberFormat:
            model.addOp(.numberFormat, label: "Round \u{201C}\(column)\u{201D} to \(Int(decimals)) dp",
                        params: ["column": .string(column), "decimals": .number(decimals)])
        case .expression:
            if exprName.isEmpty {
                model.addOp(.expression, label: "Formula on \u{201C}\(column)\u{201D}",
                            params: ["expr": .string(expr), "mode": .string("replace"),
                                     "target": .string(column)])
            } else {
                model.addOp(.expression, label: "Formula \u{2192} \u{201C}\(exprName)\u{201D}",
                            params: ["expr": .string(expr), "mode": .string("new"),
                                     "name": .string(exprName)])
            }
        }
    }
}

// MARK: - Cluster sheet

struct ClusterSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var method: Algorithms.ClusterMethod = .fingerprint
    @State private var accepted: Set<String> = []
    @State private var clusters: [Algorithms.Cluster] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cluster & merge \u{201C}\(model.selectedColumn ?? "")\u{201D}")
                .font(.title3.bold())
            Picker("Method", selection: $method) {
                ForEach(Algorithms.ClusterMethod.allCases, id: \.self) { m in
                    Text(m.label).tag(m)
                }
            }
            .pickerStyle(.segmented)
            if clusters.isEmpty {
                Text("No similar-value groups found with this method.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 30)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(clusters) { cluster in
                            HStack(alignment: .top, spacing: 10) {
                                Toggle("", isOn: Binding(
                                    get: { accepted.contains(cluster.key) },
                                    set: { on in
                                        if on { accepted.insert(cluster.key) }
                                        else { accepted.remove(cluster.key) }
                                    }))
                                    .toggleStyle(.checkbox)
                                    .labelsHidden()
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(cluster.values.map { "\($0.value) (\($0.count))" }
                                        .joined(separator: "  ·  "))
                                        .font(.callout)
                                    Text("\u{2192} \(cluster.suggestion)")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(Theme.accent)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(8)
                            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 9))
                        }
                    }
                }
                .frame(maxHeight: 340)
            }
            HStack {
                Text("\(accepted.count) of \(clusters.count) groups selected")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Merge Selected") { apply(); dismiss() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(accepted.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 560)
        .onAppear { recompute(selectAll: true) }
        .onChange(of: method) { recompute(selectAll: true) }
    }

    private func recompute(selectAll: Bool) {
        guard let name = model.selectedColumn else { clusters = []; return }
        clusters = model.clusters(for: name, method: method)
        if selectAll { accepted = Set(clusters.map(\.key)) }
    }

    private func apply() {
        guard let name = model.selectedColumn else { return }
        var mapping: [String: String] = [:]
        for cluster in clusters where accepted.contains(cluster.key) {
            for member in cluster.values where member.value != cluster.suggestion {
                mapping[member.value] = cluster.suggestion
            }
        }
        model.applyClusterMerge(column: name, mapping: mapping)
    }
}
