import { join } from "node:path";
import { build } from "vite";
import appConfig from "../../src-tauri/tauri.conf.json" with { type: "json" };

export async function buildWebviewFixture(
  dir: string,
  ports: number[],
  platform: "macos" | "android",
) {
  const frontendDist = join(dir, "ui");
  await build({
    configFile: false,
    root: "scripts/webview-check",
    define: {
      "import.meta.env.UMMKA_MACOS_OVERLAY": platform === "macos",
      "import.meta.env.VITE_UMMKA_CHECK_PORTS": JSON.stringify(ports.join(",")),
    },
    build: { outDir: frontendDist },
  });
  return JSON.stringify({
    build: { frontendDist, beforeBuildCommand: null },
    plugins: { ummkaFixture: { dataPort: ports[0] } },
    app: {
      windows: [
        {
          ...appConfig.app.windows[0],
          label: "main",
          visible: platform === "android",
        },
      ],
      ...(platform === "macos" && {
        appDirectoriesOverride: { localData: join(dir, "data") },
      }),
    },
  });
}
