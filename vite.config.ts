import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { host: process.env.TAURI_DEV_HOST, port: 1420, strictPort: true },
});
