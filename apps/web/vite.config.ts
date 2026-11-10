import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.PORT ?? "4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: "dist", sourcemap: true },
});
