import SwiftUI

@main
struct TidysetApp: App {
    @StateObject private var access = AccessManager.shared

    var body: some Scene {
        WindowGroup {
            TidysetWebView(access: access)
                .ignoresSafeArea(.container, edges: .bottom)
                #if os(macOS)
                .frame(minWidth: 1040, minHeight: 720)
                #endif
        }
    }
}
