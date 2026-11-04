import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Any request starting with /api is forwarded to the backend. No CORS setup needed in dev.
    proxy: { "/api": "http://localhost:4000" },
  },
});