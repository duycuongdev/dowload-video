import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Dedicated port so the double-click launcher never collides with other apps.
    port: 5180,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
