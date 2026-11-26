import { cp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";
import appConfig from "../../src-tauri/tauri.conf.json" with { type: "json" };

export async function buildWebviewFixture(
  dir: string,
  ports: number[],
  platform: "macos" | "android",
  externalHref?: string,
) {
  const frontendDist = join(dir, "ui");
  await build({
    configFile: false,
    root: "scripts/webview-check",
    define: {
      "import.meta.env.UMMKA_PLATFORM": JSON.stringify(
        platform === "macos" ? "darwin" : platform,
      ),
      "import.meta.env.VITE_UMMKA_CHECK_EXTERNAL_HREF": JSON.stringify(
        externalHref ?? "",
      ),
      "import.meta.env.VITE_UMMKA_CHECK_PORTS": JSON.stringify(ports.join(",")),
    },
    build: { outDir: frontendDist },
  });
  // Vite copied the fixture’s terminal page. Add the application assets without replacing it.
  for (const entry of await readdir("public")) {
    await cp(join("public", entry), join(frontendDist, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  return JSON.stringify({
    build: { frontendDist, beforeBuildCommand: null },
    plugins: { ummkaFixture: { dataPort: ports[0] } },
    app: {
      windows: [
        {
          ...appConfig.app.windows[0],
          label: "main",
          visible: platform === "android",
          // Keep layout observers running in the hidden macOS test window.
          ...(platform === "macos" && { backgroundThrottling: "disabled" }),
        },
      ],
      ...(platform === "macos" && {
        appDirectoriesOverride: { localData: join(dir, "data") },
      }),
    },
  });
}
