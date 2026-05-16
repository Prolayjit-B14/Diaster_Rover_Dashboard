import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  root: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'dashboard/dashboard.html'),
        camera: resolve(__dirname, 'camera/camera.html'),
        map: resolve(__dirname, 'map/map.html'),
        sensors: resolve(__dirname, 'sensors/sensors.html'),
      },
    },
  },
});

