import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: abs('electron/main.ts'),
        output: { entryFileNames: 'index.js' }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: abs('electron/preload.ts'),
        output: { entryFileNames: 'index.js' }
      }
    }
  },
  renderer: {
    root: abs('.'),
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: abs('index.html') }
    },
    plugins: [react()]
  }
})
