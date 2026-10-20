import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const modulePath = id.replace(/\\/g, '/');
            if (!modulePath.includes('/node_modules/')) return;
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(modulePath)) return 'react-vendor';
            if (/\/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(modulePath)) return 'motion-vendor';
            if (modulePath.includes('/node_modules/leaflet/')) return 'map-vendor';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
