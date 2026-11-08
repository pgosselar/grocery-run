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
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Grocery Run",
        short_name: "Groceries",
        description: "Shared family grocery lists",
        display: "standalone",
        start_url: "/",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        runtimeCaching: [],
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
