import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          maps: ["leaflet", "react-leaflet"],
          charts: ["recharts"],
          auth: ["@supabase/supabase-js"],
          forms: ["react-hook-form", "@hookform/resolvers/zod", "zod"],
        },
      },
    },
  },
});
