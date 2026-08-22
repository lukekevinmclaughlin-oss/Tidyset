import SwiftUI
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    // Single-window utility: closing the window quits (App Review guideline 4 —
    // never leave the app running with no way to reopen its window).
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct TidysetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .frame(minWidth: 1040, minHeight: 660)
        }
        .defaultSize(width: 1360, height: 860)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open File…") { openFromMenu() }
                    .keyboardShortcut("o", modifiers: [.command])
                Button("Load Sample Data") { model.loadSample() }
                    .keyboardShortcut("d", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .undoRedo) {
                Button("Undo Last Step") { model.undoLastStep() }
                    .keyboardShortcut("z", modifiers: [.command])
                    .disabled(model.ops.isEmpty)
            }
            CommandGroup(after: .saveItem) {
                Divider()
                Menu("Export") {
                    Button("CSV…") { model.export(kind: "csv") }
                    Button("TSV…") { model.export(kind: "tsv") }
                    Button("Excel (.xlsx)…") { model.export(kind: "xlsx") }
                    Button("JSON…") { model.export(kind: "json") }
                }
                .disabled(!model.hasData)
                Button("Save Recipe…") { model.saveRecipe() }
                    .disabled(model.ops.isEmpty)
            }
        }
    }

    private func openFromMenu() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = AppModel.importTypes
        if panel.runModal() == .OK, let url = panel.url {
            model.importFile(at: url)
        }
    }
}

enum Theme {
    static let accent = Color(red: 0.24, green: 0.83, blue: 0.72)      // tidy teal
    static let accentDim = Color(red: 0.24, green: 0.83, blue: 0.72).opacity(0.16)
    static let bgTop = Color(red: 0.075, green: 0.09, blue: 0.14)
    static let bgBottom = Color(red: 0.045, green: 0.05, blue: 0.09)
    static let panel = Color.white.opacity(0.045)
    static let panelBorder = Color.white.opacity(0.08)
    static let good = Color(red: 0.35, green: 0.85, blue: 0.55)
    static let warn = Color(red: 0.98, green: 0.75, blue: 0.3)
    static let bad = Color(red: 0.96, green: 0.45, blue: 0.42)

    static func scoreColor(_ score: Int) -> Color {
        score >= 85 ? good : score >= 60 ? warn : bad
    }
}

extension View {
    func panelCard() -> some View {
        self
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.panelBorder, lineWidth: 1))
    }
}
