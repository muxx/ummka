import { afterEach, expect, test, vi } from "vitest";
import {
  createNotificationSoundPreview,
  notificationSounds,
  notificationSoundUrl,
} from "./notification-sounds.ts";

function setup() {
  class AudioStub {
    static created: AudioStub[] = [];
    onended: (() => void) | null = null;
    url: string;
    resolve!: () => void;
    reject!: (error: Error) => void;
    pending = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    play = vi.fn(() => this.pending);
    pause = vi.fn();
    removeAttribute = vi.fn();
    load = vi.fn();
    constructor(url: string) {
      this.url = url;
      AudioStub.created.push(this);
    }
  }
  vi.stubGlobal("Audio", AudioStub);
  return {
    preview: createNotificationSoundPreview(),
    created: AudioStub.created,
  };
}

afterEach(() => vi.unstubAllGlobals());

test("preview stays silent until a choice and uses only the six local assets", () => {
  const { preview, created } = setup();
  preview.stop();
  expect(created).toHaveLength(0);
  expect(notificationSounds.map(notificationSoundUrl)).toEqual(
    ["bing", "crackle", "down", "hello", "ripple", "upstairs"].map(
      (name) => `/sounds/notifications/${name}.mp3`,
    ),
  );
  expect(() =>
    notificationSoundUrl("https://example.test/audio" as "Bing"),
  ).toThrow(TypeError);
  expect(created).toHaveLength(0);
});

test("a later gesture interrupts the first selection and an old rejection is ignored", async () => {
  const { preview, created } = setup();
  const first = preview.play("Bing");
  const [a] = created;
  const ended = a.onended;
  const second = preview.play("Crackle");
  const b = created[1];
  expect(a.pause).toHaveBeenCalledOnce();
  expect(a.removeAttribute).toHaveBeenCalledWith("src");
  expect(a.load).toHaveBeenCalledOnce();
  expect(b.url).toBe("/sounds/notifications/crackle.mp3");
  ended?.();
  a.reject(new DOMException("Interrupted", "AbortError"));
  await first;
  expect(b.pause).not.toHaveBeenCalled();
  b.resolve();
  await second;
  expect(b.play).toHaveBeenCalledOnce();
  b.onended?.();
  preview.stop();
  expect(b.pause).toHaveBeenCalledOnce();
});

test("closing cancels a pending selection; an active playback refusal reaches the form", async () => {
  const { preview, created } = setup();
  const attempt = preview.play("Hello");
  preview.stop();
  created[0].reject(new Error("Interrupted"));
  await attempt;
  const next = preview.play("Ripple");
  const refused = new DOMException("Playback refused", "NotAllowedError");
  created[1].reject(refused);
  await expect(next).rejects.toBe(refused);
  expect(created[1].pause).toHaveBeenCalledOnce();
  expect(created).toHaveLength(2);
});
