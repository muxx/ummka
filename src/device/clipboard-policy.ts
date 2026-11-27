import { isAndroid } from "../build-platform.ts";
import {
  observeAndroidClipboardAllowed,
  readAndroidClipboardAllowed,
} from "./android-clipboard-policy.ts";

export function readClipboardAllowed(): Promise<boolean> {
  return isAndroid ? readAndroidClipboardAllowed() : Promise.resolve(true);
}

export function observeClipboardAllowed(report: (allowed: boolean) => void) {
  if (isAndroid) return observeAndroidClipboardAllowed(report);
  report(true);
  return () => {};
}
