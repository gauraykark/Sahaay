import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The level scale is defined once, at the repo root, and imported by both the
// client and the FastAPI service (shared/levels.js + backend/app/levels.py).
// That directory sits outside the Vite root, so it needs both an alias and an
// explicit fs.allow entry to be served in dev.
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url))
const srcDir = fileURLToPath(new URL('./src', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
      '@shared': sharedDir,
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Pre-cache the app shell so the four games, patient home, and
      // caregiver dashboard all open with zero internet after first visit.
      // Actual patient/game data lives in IndexedDB (see src/lib/db.js),
      // not in this cache — this only covers the static app shell.
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Sahaay',
        short_name: 'Sahaay',
        description:
          'Gentle cognitive support for everyday memory and daily routines.',
        theme_color: '#247a72',
        background_color: '#fafaf9',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache the app shell (HTML/JS/CSS/fonts/icons) for offline use.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
})
