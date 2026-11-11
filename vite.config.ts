import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app decides when to switch versions (src/lib/update.ts), so nobody loses what they were typing.
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon.png", "icon-maskable-512.png"],
      manifest: {
        name: "Lane Nine",
        short_name: "Lane Nine",
        description: "Family grocery lists and recipes",
        display: "standalone",
        start_url: "/",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        runtimeCaching: [
          {
            // Dish photos, so a recipe still shows its photo without signal. Each version has its own
            // address, so a cached one never goes stale.
            urlPattern: /\/api\/recipes\/[^/]+\/photo\?/,
            handler: "CacheFirst",
            options: {
              cacheName: "dish-photos",
              expiration: { maxEntries: 150 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
