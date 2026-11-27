import { invoke } from "@tauri-apps/api/core";

export async function fixtureDeadline<T>(
  step: string,
  operation: () => Promise<T> | T,
  timeout = 30_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Error(`Fixture timed out waiting for ${step}`)),
      timeout,
    );
  });
  try {
    return await Promise.race([operation(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fixtureStep<T>(
  step: string,
  operation: () => Promise<T> | T,
) {
  if (navigator.userAgent.includes("Android")) return operation();
  await invoke("trace_webview_check", { step, finished: false });
  const result = await fixtureDeadline(step, operation);
  await invoke("trace_webview_check", { step, finished: true });
  return result;
}
