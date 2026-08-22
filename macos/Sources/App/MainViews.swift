// Welcome screen, main workspace layout, data grid and toasts.
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.bgTop, Theme.bgBottom],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            if model.hasData {
                WorkspaceView()
            } else {
                WelcomeView()
            }
            ToastStack()
        }
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            guard let provider = providers.first else { return false }
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url {
                    Task { @MainActor in model.importFile(at: url) }
                }
            }
            return true
        }
        .sheet(isPresented: $model.showAddStep) { AddStepSheet() }
        .sheet(isPresented: $model.showClusters) { ClusterSheet() }
        .onAppear {
            // TIDYSET_SAMPLE=1 auto-loads the demo dataset (screenshots, UI tests).
            if ProcessInfo.processInfo.environment["TIDYSET_SAMPLE"] == "1", !model.hasData {
                model.loadSample()
            }
        }
    }
}

// MARK: - Welcome

struct WelcomeView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 26) {
            Spacer()
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(Theme.accent)
            VStack(spacing: 8) {
                Text("Tidyset").font(.system(size: 40, weight: .bold, design: .rounded))
                Text("The private, fully-offline data janitor. Clean, fix and reshape messy\nspreadsheets, with every change reviewable and reproducible.\nNo cloud. No AI. No surprises.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Button {
                    openPanel()
                } label: {
                    Label("Open a file", systemImage: "folder")
                        .padding(.horizontal, 10).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)

                Button {
                    model.loadSample()
                } label: {
                    Label("Try messy sample data", systemImage: "wand.and.stars")
                        .padding(.horizontal, 10).padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
            }
            Text("or drop a CSV, TSV, Excel or JSON file anywhere")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 34) {
                feature("lock.shield", "100% offline", "Your data never leaves\nthe machine.")
                feature("square.stack.3d.up", "Cluster & de-dupe", "Fix typos and merge\nnear-duplicates.")
                feature("arrow.triangle.2.circlepath", "Reusable recipes", "Clean once, re-run on\nnext month's file.")
            }
            .padding(.top, 12)
            Spacer()
            Spacer()
        }
        .padding(40)
    }

    private func feature(_ symbol: String, _ title: String, _ detail: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.title3).foregroundStyle(Theme.accent)
            Text(title).font(.subheadline.weight(.semibold))
            Text(detail).font(.caption).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(width: 170)
    }

    private func openPanel() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = AppModel.importTypes
        if panel.runModal() == .OK, let url = panel.url {
            model.importFile(at: url)
        }
    }
}

// MARK: - Workspace

struct WorkspaceView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 12) {
            RecipePanel()
                .frame(width: 270)
            VStack(spacing: 10) {
                HeaderBar()
                DataGridView()
                    .panelCard()
            }
            InspectorPanel()
                .frame(width: 300)
        }
        .padding(12)
    }
}

struct HeaderBar: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.fileName.isEmpty ? "Untitled" : model.fileName)
                    .font(.headline)
                    .lineLimit(1)
                Text("\(model.current.nrows) rows × \(model.current.columns.count) columns")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            let q = model.quality
            HStack(spacing: 6) {
                Circle().fill(Theme.scoreColor(q.score)).frame(width: 8, height: 8)
                Text("Quality \(q.score)")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .panelCard()
            .help("Completeness \(Int((q.completeness * 100).rounded()))% · \(q.duplicateRows) duplicate rows · \(q.emptyCells) empty cells")

            Button {
                model.showAddStep = true
            } label: {
                Label("Add Step", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)

            Menu {
                Button("CSV…") { model.export(kind: "csv") }
                Button("TSV…") { model.export(kind: "tsv") }
                Button("Excel (.xlsx)…") { model.export(kind: "xlsx") }
                Button("JSON…") { model.export(kind: "json") }
                Divider()
                Button("Save Recipe…") { model.saveRecipe() }
            } label: {
                Label("Export", systemImage: "square.and.arrow.up")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Grid

private struct RowIndexItem: Identifiable {
    let id: Int
}

struct DataGridView: View {
    @EnvironmentObject private var model: AppModel

    private let shownRowCap = 2_000

    var body: some View {
        let table = model.current
        let rows = (0..<min(table.nrows, shownRowCap)).map(RowIndexItem.init)
        VStack(spacing: 0) {
            Table(rows) {
                TableColumnForEach(table.columns, id: \.id) { col in
                    TableColumn(colTitle(col)) { (row: RowIndexItem) in
                        let cell = row.id < col.values.count ? col.values[row.id] : .null
                        Text(cell.s)
                            .foregroundStyle(cell.isBlank ? Color.secondary.opacity(0.4) : .primary)
                            .lineLimit(1)
                            .help(cell.s)
                    }
                    .width(min: 70, ideal: idealWidth(col))
                }
            }
            .scrollContentBackground(.hidden)
            if table.nrows > shownRowCap {
                Text("Showing the first \(shownRowCap) of \(table.nrows) rows — every operation still applies to all rows.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(6)
            }
        }
    }

    private func colTitle(_ col: Column) -> String {
        "\(col.name)  ·  \(col.type.label.lowercased())"
    }

    private func idealWidth(_ col: Column) -> CGFloat {
        switch col.type {
        case .integer, .decimal: return 90
        case .date: return 110
        case .boolean: return 80
        case .text: return 170
        }
    }
}

// MARK: - Toasts

struct ToastStack: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: 8) {
                ForEach(model.toasts) { toast in
                    Text(toast.text)
                        .font(.callout)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.ultraThinMaterial, in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.panelBorder))
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.bottom, 18)
        }
        .animation(.easeOut(duration: 0.2), value: model.toasts)
        .allowsHitTesting(false)
    }
}
