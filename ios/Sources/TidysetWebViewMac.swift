#if os(macOS)
import SwiftUI
import WebKit
import AppKit
import UniformTypeIdentifiers

struct TidysetWebView: NSViewControllerRepresentable {
    let access: AccessManager

    func makeCoordinator() -> Coordinator { Coordinator(access: access) }

    func makeNSViewController(context: Context) -> NSViewController {
        let controller = NSViewController()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "tidyset")
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        controller.view = webView
        context.coordinator.webView = webView
        access.onChange = { [weak coordinator = context.coordinator] in coordinator?.pushAccessState() }
        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web"),
           let root = Bundle.main.resourceURL?.appendingPathComponent("Web") {
            var launchURL = index
            if ProcessInfo.processInfo.environment["TIDYSET_DEMO"] == "1",
               var components = URLComponents(url: index, resolvingAgainstBaseURL: false) {
                components.queryItems = [URLQueryItem(name: "demo", value: "1")]
                launchURL = components.url ?? index
            }
            webView.loadFileURL(launchURL, allowingReadAccessTo: root)
        }
        return controller
    }

    func updateNSViewController(_ nsViewController: NSViewController, context: Context) {}

    private static let bridgeScript = #"""
    (() => {
      let nextID = 1; const callbacks = new Map();
      const call = (action, payload = {}) => new Promise((resolve, reject) => {
        const id = String(nextID++); callbacks.set(id, {resolve, reject});
        window.webkit.messageHandlers.tidyset.postMessage({id, action, payload});
      });
      const bytesToBase64 = (buffer) => {
        const bytes = new Uint8Array(buffer); let binary = ''; const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return btoa(binary);
      };
      const base64ToBuffer = (base64) => {
        const binary = atob(base64), bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
      };
      window.__tidysetResolve = (id, value, error) => {
        const cb = callbacks.get(String(id)); if (!cb) return; callbacks.delete(String(id));
        error ? cb.reject(new Error(error)) : cb.resolve(value);
      };
      window.__tidysetAccessChanged = (state) => window.__tidysetAccessListener?.(state);
      window.tidyset = {
        openFile: async () => { const f = await call('openFile'); if (f?.base64) f.bytes = base64ToBuffer(f.base64); return f; },
        readFile: async () => new ArrayBuffer(0),
        saveFile: (defaultName, data) => call('saveFile', {defaultName, kind: typeof data === 'string' ? 'text' : 'base64', data: typeof data === 'string' ? data : bytesToBase64(data)}),
        getTheme: async () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        getAccess: () => call('getAccess'),
        purchaseSubscription: (plan) => call('purchase', {plan}),
        restorePurchases: () => call('restore'),
        openExternal: (url) => call('openExternal', {url}),
        onAccessChanged: (listener) => { window.__tidysetAccessListener = listener; return () => { window.__tidysetAccessListener = null; }; }
      };
    })();
    """#

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?
        let access: AccessManager
        init(access: AccessManager) { self.access = access }

        nonisolated func userContentController(_ userContentController: WKUserContentController,
                                               didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let id = body["id"] as? String,
                  let action = body["action"] as? String else { return }
            let payload = body["payload"] as? [String: Any] ?? [:]
            Task { @MainActor in self.handle(id, action, payload) }
        }

        private func handle(_ id: String, _ action: String, _ payload: [String: Any]) {
            switch action {
            case "getAccess": reply(id, access.state)
            case "purchase": Task { reply(id, await access.purchase(plan: payload["plan"] as? String ?? "yearly")) }
            case "restore": Task { reply(id, await access.restore()) }
            case "openExternal":
                guard let raw = payload["url"] as? String, let url = URL(string: raw) else { reply(id, false); return }
                reply(id, NSWorkspace.shared.open(url))
            case "openFile": openFile(id)
            case "saveFile": saveFile(id, payload)
            default: reply(id, NSNull(), error: "Unsupported action")
            }
        }

        private func openFile(_ id: String) {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [
                .commaSeparatedText, .tabSeparatedText, .json, .plainText,
                UTType(filenameExtension: "xlsx") ?? .data,
                UTType(filenameExtension: "xls") ?? .data
            ]
            panel.allowsMultipleSelection = false
            guard panel.runModal() == .OK, let url = panel.url else { reply(id, NSNull()); return }
            do {
                let data = try Data(contentsOf: url)
                reply(id, ["path": url.path, "name": url.lastPathComponent, "base64": data.base64EncodedString()])
            } catch { reply(id, NSNull(), error: error.localizedDescription) }
        }

        private func saveFile(_ id: String, _ payload: [String: Any]) {
            guard let name = payload["defaultName"] as? String,
                  let kind = payload["kind"] as? String, let raw = payload["data"] as? String else {
                reply(id, NSNull(), error: "Invalid export data"); return
            }
            let panel = NSSavePanel(); panel.nameFieldStringValue = name
            guard panel.runModal() == .OK, let url = panel.url else { reply(id, NSNull()); return }
            let data = kind == "base64" ? Data(base64Encoded: raw) : raw.data(using: .utf8)
            do { try data?.write(to: url, options: .atomic); reply(id, url.path) }
            catch { reply(id, NSNull(), error: error.localizedDescription) }
        }

        func pushAccessState() {
            guard let json = json(access.state) else { return }
            webView?.evaluateJavaScript("window.__tidysetAccessChanged(\(json));")
        }

        private func reply(_ id: String, _ value: Any, error: String? = nil) {
            let valueJSON = json(value) ?? "null", errorJSON = error.flatMap(json) ?? "null"
            webView?.evaluateJavaScript("window.__tidysetResolve(\(json(id)!), \(valueJSON), \(errorJSON));")
        }

        private func json(_ value: Any) -> String? {
            if JSONSerialization.isValidJSONObject(value) {
                return (try? JSONSerialization.data(withJSONObject: value)).flatMap { String(data: $0, encoding: .utf8) }
            }
            let wrapped = [value]
            guard JSONSerialization.isValidJSONObject(wrapped),
                  let data = try? JSONSerialization.data(withJSONObject: wrapped),
                  let text = String(data: data, encoding: .utf8), text.count >= 2 else { return nil }
            return String(text.dropFirst().dropLast())
        }
    }
}
#endif
