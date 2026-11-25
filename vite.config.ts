import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.UMMKA_MOBILE": ["android", "ios"].includes(
      process.env.TAURI_ENV_PLATFORM ?? "",
    ),
    "import.meta.env.UMMKA_MACOS_OVERLAY":
      process.env.TAURI_ENV_PLATFORM === "darwin",
  },
  server: { host: process.env.TAURI_DEV_HOST, port: 1420, strictPort: true },
});
