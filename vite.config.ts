import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.UMMKA_PLATFORM": JSON.stringify(
      process.env.TAURI_ENV_PLATFORM ?? "",
    ),
  },
  server: { host: process.env.TAURI_DEV_HOST, port: 1420, strictPort: true },
});
