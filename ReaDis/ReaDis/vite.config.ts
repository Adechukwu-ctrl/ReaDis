import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Base path for assets; set via VITE_PUBLIC_BASE (e.g., "/repo-name/") for GitHub Pages
  base: process.env.VITE_PUBLIC_BASE || '/',
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist', 'lucide-react'],
    exclude: ['pdfjs-dist/build/pdf.worker.min.mjs']
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 5174,
    strictPort: true,
    hmr: {
      clientPort: 5174,
      host: 'localhost',
      overlay: false
    },
    fs: {
      allow: ['..']
    },
    cors: true,
    host: true
  },
  define: {
    global: 'globalThis',
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor libraries into their own chunks
          'react-vendor': ['react', 'react-dom'],
          'pdf-vendor': ['pdfjs-dist'],
          'ocr-vendor': ['tesseract.js'],
          'ui-vendor': ['lucide-react'],
        },
      },
    },
  },
});