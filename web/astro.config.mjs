import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://crjobs-api.onrender.com',
  vite: {
    server: {
      proxy: {
        '/api': {
          target: 'https://crjobs-api.onrender.com',
          changeOrigin: true,
        },
      },
    },
  },
});
