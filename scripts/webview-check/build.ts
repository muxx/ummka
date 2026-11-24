import { join } from "node:path";
import { build } from "vite";

export async function buildWebviewFixture(dir: string, ports: number[]) {
  const frontendDist = join(dir, "ui");
  await build({
    configFile: false,
    root: "scripts/webview-check",
    define: {
      "import.meta.env.VITE_UMMKA_CHECK_PORTS": JSON.stringify(ports.join(",")),
    },
    build: { outDir: frontendDist },
  });
  return JSON.stringify({
    build: { frontendDist, beforeBuildCommand: null },
    app: { windows: [{ label: "main", title: "ummka", visible: false }] },
  });
}
