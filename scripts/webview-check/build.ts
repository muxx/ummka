import { join } from "node:path";
import { build } from "vite";

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
          label: "main",
          title: "ummka",
          visible: false,
          ...(platform === "macos" && { width: 1180, height: 750 }),
        },
      ],
      ...(platform === "macos" && {
        appDirectoriesOverride: { localData: join(dir, "data") },
      }),
    },
  });
}
