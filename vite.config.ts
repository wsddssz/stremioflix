import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NOTE: Do NOT enable Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
// here. COEP: require-corp makes Firefox (and Chromium) block every cross-origin
// image/video/subtitle that doesn't send CORP headers (Cinemeta, weserv proxy,
// YouTube embeds, addon streams) with NS_ERROR_DOM_COEP_FAILED / ERR_BLOCKED_BY_RESPONSE.
// FFmpeg.wasm single-threaded build works fine without SharedArrayBuffer.
export default defineConfig({
  // Relative asset paths so the bundle also works when opened from disk
  // (the desktop shell serves it over loopback HTTP, file:// is a fallback).
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/stremio-stream': {
        target: 'http://127.0.0.1:11470',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/stremio-stream/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
