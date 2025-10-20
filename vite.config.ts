import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist', 'lucide-react', 'react-pdf'],
    exclude: ['pdfjs-dist/build/pdf.worker.min.mjs']
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    fs: {
      allow: ['..']
    },
    hmr: {
      clientPort: 5173,
      host: 'localhost',
      overlay: false
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
          'pdf-vendor': ['pdfjs-dist', 'react-pdf'],
          'ocr-vendor': ['tesseract.js'],
          'ui-vendor': ['lucide-react'],
        },
      },
    },
  },
});
