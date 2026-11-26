import type { ExecFileException } from "node:child_process";

export class NativeInstrumentationError extends Error {}

type CommandFailure = ExecFileException & { stdout?: string; stderr?: string };

export async function checkNativeInstrumentation(
  run: () => Promise<string>,
  readPid: () => Promise<string>,
  lastProbe: () => string,
) {
  let output = "";
  let reason = "invalid instrumentation result";
  try {
    output = await run();
    if (
      /^INSTRUMENTATION_RESULT: result=PASS\r?$/m.test(output) &&
      /^INSTRUMENTATION_CODE: -1\r?$/m.test(output)
    )
      return;
  } catch (error) {
    const failure = error as CommandFailure;
    output = failure.stdout ?? "";
    reason =
      failure.signal ??
      (typeof failure.code === "number"
        ? `exit ${failure.code}`
        : "adb failed");
  }

  const stages = output.matchAll(
    /^INSTRUMENTATION_STATUS: ummka_stage=(activity-idle|install-ca|native-setup|sqlite|transport)\r?$/gm,
  );
  const stage = Array.from(stages).at(-1)?.[1] ?? "not reported";
  let process = "unavailable";
  try {
    const pid = (await readPid()).trim();
    if (/^\d+$/.test(pid)) process = `PID ${pid}`;
  } catch (error) {
    const failure = error as CommandFailure;
    if (failure.code === 1 && !failure.stderr?.trim()) process = "absent";
  }
  throw new NativeInstrumentationError(
    `Android native HTTP check failed (${reason}). Stage: ${stage}. Last local probe: ${lastProbe()}. App process: ${process}.`,
  );
}
