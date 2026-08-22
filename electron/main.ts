import { app, BrowserWindow, ipcMain, dialog, nativeTheme, protocol } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join, extname, normalize, sep } from 'node:path'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// The packaged renderer is served over a custom `app://` scheme rather than
// `file://`. Chromium blocks ES-module `<script type="module">` loads from
// file:// (CORS), which left the Mac App Store build showing a blank window.
// Reading the bundled files with fs (not net.fetch, which the sandbox blocks)
// serves them from a standard, secure origin so modules load correctly.
const RENDERER_DIR = join(__dirname, '../renderer')
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
}

if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url)
    const rel = pathname === '/' || pathname === '' ? '/index.html' : decodeURIComponent(pathname)
    // Resolve within the renderer directory only (no path traversal).
    const filePath = normalize(join(RENDERER_DIR, rel))
    if (filePath !== RENDERER_DIR && !filePath.startsWith(RENDERER_DIR + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const data = await readFile(filePath)
      const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'content-type': mime } })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

type AccessState = {
  hasAccess: boolean
  isPurchased: boolean
  isTrialActive: boolean
  daysRemaining: number
  price: string
  monthlyPrice: string
  yearlyPrice: string
}

type StoredAccess = { trialStartedAt: string; isPurchased: boolean }
let monthlyPrice = '€4,99'
let yearlyPrice = '€29,99'

async function accessFile(): Promise<string> {
  return join(app.getPath('userData'), 'access.json')
}

async function readAccess(): Promise<StoredAccess> {
  try {
    const parsed = JSON.parse(await readFile(await accessFile(), 'utf8')) as StoredAccess
    if (parsed.trialStartedAt) return parsed
  } catch {}
  const initial: StoredAccess = { trialStartedAt: new Date().toISOString(), isPurchased: false }
  await writeFile(await accessFile(), JSON.stringify(initial), { encoding: 'utf8', mode: 0o600 })
  return initial
}

async function getAccessState(): Promise<AccessState> {
  const stored = await readAccess()
  // Tidyset is a free app: every feature is unlocked in all distributions.
  return {
    hasAccess: true,
    isPurchased: stored.isPurchased,
    isTrialActive: false,
    daysRemaining: 0,
    price: yearlyPrice,
    monthlyPrice,
    yearlyPrice
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 22 },
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`)
  })

  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    win.loadURL('app://bundle/index.html')
  }
}

// ---- File IO (no network, everything local) ----
ipcMain.handle('dialog:openFile', async () => {
  const res = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Data files', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const path = res.filePaths[0]
  const buf = await readFile(path)
  return { path, name: path.split('/').pop() ?? 'data', bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
})

ipcMain.handle('file:read', async (_e, path: string) => {
  const buf = await readFile(path)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
})

ipcMain.handle('dialog:saveFile', async (_e, defaultName: string, data: ArrayBuffer | string) => {
  const res = await dialog.showSaveDialog({ defaultPath: defaultName })
  if (res.canceled || !res.filePath) return null
  const payload = typeof data === 'string' ? data : Buffer.from(data)
  await writeFile(res.filePath, payload)
  return res.filePath
})

ipcMain.handle('theme:get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
ipcMain.handle('access:get', () => getAccessState())
// Tidyset is free: no StoreKit at all. Touching inAppPurchase at startup
// (especially restoreCompletedTransactions) pops an Apple Account sign-in
// dialog on first launch, which App Review rightly rejects for a free app.
ipcMain.handle('access:purchase', async () => false)
ipcMain.handle('access:restore', async () => false)

app.whenReady().then(() => {
  if (!isDev) registerAppProtocol()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Tidyset is a single-window app. Quit when the main window is closed so there
  // is always a clear way to leave the app, rather than leaving it running with
  // no window and no menu item to reopen it (App Review guideline 4.0).
  app.quit()
})
