// Observable app state: source table, recipe ops, folded snapshots, analysis.
import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct Toast: Identifiable, Equatable {
    let id = UUID()
    var text: String
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var source: DataTable?
    @Published private(set) var fileName: String = ""
    @Published private(set) var ops: [TidyOp] = []
    @Published private(set) var snapshots: [DataTable] = []
    @Published var selectedColumn: String?
    @Published var toasts: [Toast] = []
    @Published var showAddStep = false
    @Published var showClusters = false

    var current: DataTable { snapshots.last ?? source ?? .empty }
    var hasData: Bool { source != nil }

    private(set) var quality: Quality = .empty
    private(set) var suggestions: [Suggestion] = []

    // MARK: - Import

    static let importTypes: [UTType] = {
        var types: [UTType] = [.commaSeparatedText, .tabSeparatedText, .json]
        if let xlsx = UTType(filenameExtension: "xlsx") { types.append(xlsx) }
        if let tidyset = UTType(filenameExtension: "tidyset") { types.append(tidyset) }
        return types
    }()

    func importFile(at url: URL) {
        let secured = url.startAccessingSecurityScopedResource()
        defer { if secured { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            if url.pathExtension.lowercased() == "tidyset" {
                let recipe = try TidyIO.decodeRecipe(data)
                ops = recipe.ops
                refold()
                toast("Recipe \u{201C}\(recipe.name)\u{201D} loaded — \(recipe.ops.count) steps")
                return
            }
            let table = try TidyIO.parse(name: url.lastPathComponent, data: data)
            source = table
            fileName = url.lastPathComponent
            ops = []
            selectedColumn = table.columns.first?.name
            refold()
            toast("Loaded \(table.nrows) rows × \(table.columns.count) columns")
        } catch {
            toast(error.localizedDescription)
        }
    }

    func loadSample() {
        source = SampleData.table()
        fileName = "Sample — messy signups.csv"
        ops = []
        selectedColumn = source?.columns.first?.name
        refold()
        toast("Sample data loaded — try the suggestions on the left")
    }

    // MARK: - Recipe ops

    func addOp(_ type: OpType, label: String, params: [String: ParamValue]) {
        ops.append(TidyOp(id: UID.make("op"), type: type, label: label, enabled: true, params: params))
        refold()
    }

    func applySuggestion(_ s: Suggestion) {
        addOp(s.opType, label: s.title, params: s.params)
        toast("Applied: \(s.title)")
    }

    func removeOp(_ id: String) {
        ops.removeAll { $0.id == id }
        refold()
    }

    func toggleOp(_ id: String) {
        guard let i = ops.firstIndex(where: { $0.id == id }) else { return }
        ops[i].enabled.toggle()
        refold()
    }

    func undoLastStep() {
        guard !ops.isEmpty else { return }
        let removed = ops.removeLast()
        refold()
        toast("Removed step: \(removed.label)")
    }

    func clearRecipe() {
        ops.removeAll()
        refold()
    }

    func delta(forOpAt index: Int) -> Pipeline.StepDelta? {
        guard index + 1 < snapshots.count else { return nil }
        return Pipeline.stepDelta(snapshots[index], snapshots[index + 1])
    }

    private func refold() {
        guard let source else {
            snapshots = []
            quality = .empty
            suggestions = []
            return
        }
        snapshots = Pipeline.foldAll(source, ops)
        let table = snapshots.last ?? source
        quality = QualityScorer.datasetQuality(table)
        suggestions = Suggest.fixes(table)
        if let selectedColumn, table.column(named: selectedColumn) == nil {
            self.selectedColumn = table.columns.first?.name
        }
        objectWillChange.send()
    }

    // MARK: - Export

    func export(kind: String) {
        let table = current
        guard table.columns.count > 0 else { return }
        let panel = NSSavePanel()
        let base = (fileName as NSString).deletingPathExtension
        let stem = base.isEmpty ? "tidyset" : base
        switch kind {
        case "csv":
            panel.allowedContentTypes = [.commaSeparatedText]
            panel.nameFieldStringValue = "\(stem)-clean.csv"
        case "tsv":
            panel.allowedContentTypes = [.tabSeparatedText]
            panel.nameFieldStringValue = "\(stem)-clean.tsv"
        case "json":
            panel.allowedContentTypes = [.json]
            panel.nameFieldStringValue = "\(stem)-clean.json"
        case "xlsx":
            if let t = UTType(filenameExtension: "xlsx") { panel.allowedContentTypes = [t] }
            panel.nameFieldStringValue = "\(stem)-clean.xlsx"
        default:
            return
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            switch kind {
            case "csv": try TidyIO.toCSV(table).data(using: .utf8)?.write(to: url)
            case "tsv": try TidyIO.toCSV(table, delimiter: "\t").data(using: .utf8)?.write(to: url)
            case "json": try TidyIO.toJSON(table).data(using: .utf8)?.write(to: url)
            case "xlsx": try TidyIO.toXLSX(table).write(to: url)
            default: break
            }
            toast("Exported \(url.lastPathComponent)")
        } catch {
            toast("Export failed: \(error.localizedDescription)")
        }
    }

    func saveRecipe() {
        guard !ops.isEmpty else { toast("The recipe is empty."); return }
        let panel = NSSavePanel()
        if let t = UTType(filenameExtension: "tidyset") { panel.allowedContentTypes = [t] }
        panel.nameFieldStringValue = "cleanup.tidyset"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let iso = ISO8601DateFormatter().string(from: Date())
        let recipe = Recipe(name: (url.lastPathComponent as NSString).deletingPathExtension,
                            createdAt: iso, ops: ops)
        do {
            try TidyIO.encodeRecipe(recipe).write(to: url)
            toast("Recipe saved — re-apply it to next month's file")
        } catch {
            toast("Could not save the recipe: \(error.localizedDescription)")
        }
    }

    // MARK: - Clusters

    func clusters(for columnName: String, method: Algorithms.ClusterMethod) -> [Algorithms.Cluster] {
        guard let col = current.column(named: columnName) else { return [] }
        var counts: [String: Int] = [:]
        var order: [String] = []
        for v in col.values where !v.isBlank {
            let s = v.s
            if counts[s] == nil { order.append(s) }
            counts[s, default: 0] += 1
        }
        let distinct = order.map { Algorithms.ClusterMember(value: $0, count: counts[$0]!) }
        return Algorithms.buildClusters(distinct, method: method)
    }

    func applyClusterMerge(column: String, mapping: [String: String]) {
        guard !mapping.isEmpty else { return }
        addOp(.clusterMerge,
              label: "Merge \(mapping.count) variant\(mapping.count == 1 ? "" : "s") in \u{201C}\(column)\u{201D}",
              params: ["column": .string(column), "mapping": .mapping(mapping)])
        toast("Merged \(mapping.count) variant\(mapping.count == 1 ? "" : "s")")
    }

    // MARK: - Toasts

    func toast(_ text: String) {
        let t = Toast(text: text)
        toasts.append(t)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            self?.toasts.removeAll { $0.id == t.id }
        }
    }
}
