#if os(iOS)
import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct TidysetWebView: UIViewControllerRepresentable {
    let access: AccessManager

    func makeCoordinator() -> Coordinator { Coordinator(access: access) }

    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "tidyset")
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // Serve the bundled web build over a custom scheme so it has a real
        // (non-file://) origin. Loading Vite's `<script type="module">` from a
        // file:// URL fails in WKWebView (opaque origin blocks the module
        // fetch), which showed up as a blank screen on launch.
        if let webRoot = Bundle.main.resourceURL?.appendingPathComponent("Web") {
            configuration.setURLSchemeHandler(TidysetSchemeHandler(root: webRoot), forURLScheme: "app")
        }
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        controller.view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: controller.view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: controller.view.bottomAnchor)
        ])
        context.coordinator.webView = webView
        context.coordinator.host = controller
        access.onChange = { [weak coordinator = context.coordinator] in coordinator?.pushAccessState() }

        var launchURLString = "app://local/index.html"
        if ProcessInfo.processInfo.environment["TIDYSET_DEMO"] == "1" {
            launchURLString += "?demo=1"
        }
        if let launchURL = URL(string: launchURLString) {
            webView.load(URLRequest(url: launchURL))
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}

    private static let bridgeScript = #"""
    (() => {
      let nextID = 1;
      const callbacks = new Map();
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
        saveFile: (defaultName, data) => call('saveFile', {
          defaultName, kind: typeof data === 'string' ? 'text' : 'base64',
          data: typeof data === 'string' ? data : bytesToBase64(data)
        }),
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
    final class Coordinator: NSObject, WKScriptMessageHandler, UIDocumentPickerDelegate {
        weak var webView: WKWebView?
        weak var host: UIViewController?
        let access: AccessManager
        private var pendingID: String?
        private var pendingExportName: String?

        init(access: AccessManager) { self.access = access }

        nonisolated func userContentController(_ userContentController: WKUserContentController,
                                               didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let id = body["id"] as? String,
                  let action = body["action"] as? String else { return }
            let payload = body["payload"] as? [String: Any] ?? [:]
            Task { @MainActor in self.handle(id: id, action: action, payload: payload) }
        }

        private func handle(id: String, action: String, payload: [String: Any]) {
            switch action {
            case "getAccess": reply(id, access.state)
            case "purchase":
                Task { reply(id, await access.purchase(plan: payload["plan"] as? String ?? "yearly")) }
            case "restore":
                Task { reply(id, await access.restore()) }
            case "openExternal":
                guard let raw = payload["url"] as? String, let url = URL(string: raw) else { reply(id, false); return }
                UIApplication.shared.open(url) { opened in self.reply(id, opened) }
            case "openFile": presentOpenPicker(id: id)
            case "saveFile": presentSavePicker(id: id, payload: payload)
            default: reply(id, NSNull(), error: "Unsupported action")
            }
        }

        private func presentOpenPicker(id: String) {
            let types = [UTType.commaSeparatedText, .tabSeparatedText, .json, .plainText,
                         UTType(filenameExtension: "xlsx") ?? .data]
            pendingID = id
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.delegate = self
            host?.present(picker, animated: true)
        }

        private func presentSavePicker(id: String, payload: [String: Any]) {
            guard let name = payload["defaultName"] as? String,
                  let kind = payload["kind"] as? String,
                  let raw = payload["data"] as? String else {
                reply(id, NSNull(), error: "Invalid export data"); return
            }
            let data = kind == "base64" ? Data(base64Encoded: raw) : raw.data(using: .utf8)
            guard let data else { reply(id, NSNull(), error: "Could not encode export"); return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            do { try data.write(to: url, options: .atomic) }
            catch { reply(id, NSNull(), error: error.localizedDescription); return }
            pendingID = id; pendingExportName = name
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            host?.present(picker, animated: true)
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let id = pendingID else { return }
            defer { pendingID = nil; pendingExportName = nil }
            if let exportName = pendingExportName {
                reply(id, urls.first?.lastPathComponent ?? exportName)
                return
            }
            guard let url = urls.first else { reply(id, NSNull()); return }
            do {
                let data = try Data(contentsOf: url)
                reply(id, ["path": url.path, "name": url.lastPathComponent, "base64": data.base64EncodedString()])
            } catch { reply(id, NSNull(), error: error.localizedDescription) }
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            if let id = pendingID { reply(id, NSNull()) }
            pendingID = nil; pendingExportName = nil
        }

        func pushAccessState() {
            guard let json = json(access.state) else { return }
            webView?.evaluateJavaScript("window.__tidysetAccessChanged(\(json));")
        }

        private func reply(_ id: String, _ value: Any, error: String? = nil) {
            let valueJSON = json(value) ?? "null"
            let errorJSON = error.flatMap { json($0) } ?? "null"
            webView?.evaluateJavaScript("window.__tidysetResolve(\(json(id)!), \(valueJSON), \(errorJSON));")
        }

        private func json(_ value: Any) -> String? {
            if JSONSerialization.isValidJSONObject(value) {
                let data = try? JSONSerialization.data(withJSONObject: value)
                return data.flatMap { String(data: $0, encoding: .utf8) }
            }
            let wrapped = [value]
            guard JSONSerialization.isValidJSONObject(wrapped),
                  let data = try? JSONSerialization.data(withJSONObject: wrapped),
                  let text = String(data: data, encoding: .utf8), text.count >= 2 else { return nil }
            return String(text.dropFirst().dropLast())
        }
    }
}

/// Serves the bundled `Web/` build over a custom `app://` scheme so the web app
/// runs from a real origin (ES module scripts and `script-src 'self'` CSP both
/// require this — they fail under `file://`).
final class TidysetSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var relative = url.path
        if relative.hasPrefix("/") { relative.removeFirst() }
        if relative.isEmpty { relative = "index.html" }
        let fileURL = root.appendingPathComponent(relative)

        guard let data = try? Data(contentsOf: fileURL) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
            return
        }
        let headers = [
            "Content-Type": Self.mimeType(forExtension: fileURL.pathExtension),
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache"
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }
}
#endif
