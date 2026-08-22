import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFile: (): Promise<{ path: string; name: string; bytes: ArrayBuffer } | null> =>
    ipcRenderer.invoke('dialog:openFile'),
  readFile: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke('file:read', path),
  saveFile: (defaultName: string, data: ArrayBuffer | string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, data),
  getTheme: (): Promise<'dark' | 'light'> => ipcRenderer.invoke('theme:get'),
  getAccess: () => ipcRenderer.invoke('access:get'),
  purchaseSubscription: (plan: 'monthly' | 'yearly'): Promise<boolean> => ipcRenderer.invoke('access:purchase', plan),
  restorePurchases: (): Promise<boolean> => ipcRenderer.invoke('access:restore'),
  onAccessChanged: (listener: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => listener(state)
    ipcRenderer.on('access:changed', handler)
    return () => ipcRenderer.removeListener('access:changed', handler)
  }
}

contextBridge.exposeInMainWorld('tidyset', api)
export type TidysetAPI = typeof api
