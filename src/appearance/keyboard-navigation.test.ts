import { expect, test, vi } from "vitest";
import { observeKeyboardNavigation } from "./keyboard-navigation";

test("only trusted Tab and pointer input change keyboard focus presentation", () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const stop = observeKeyboardNavigation(window);
  const keydown = add.mock.calls.find(([type]) => type === "keydown")?.[1];
  const pointerdown = add.mock.calls.find(
    ([type]) => type === "pointerdown",
  )?.[1];
  const active = () =>
    document.documentElement.hasAttribute("data-keyboard-navigation");

  try {
    if (typeof keydown !== "function" || typeof pointerdown !== "function")
      throw Error("Missing window input listeners");
    const key = (options: Partial<KeyboardEvent>) =>
      keydown({ key: "Tab", isTrusted: true, ...options } as KeyboardEvent);
    const press = (isTrusted: boolean) =>
      pointerdown({ isTrusted } as PointerEvent);

    expect(active()).toBe(false);
    key({ isTrusted: false });
    key({ ctrlKey: true });
    key({ metaKey: true });
    key({ isComposing: true });
    key({ key: "a" });
    expect(active()).toBe(false);

    key({ shiftKey: true });
    expect(active()).toBe(true);
    press(false);
    key({ key: "a" });
    expect(active()).toBe(true);

    press(true);
    key({ key: "Enter" });
    expect(active()).toBe(false);
    key({});
    expect(active()).toBe(true);
  } finally {
    stop();
    expect(active()).toBe(false);
    expect(remove).toHaveBeenCalledWith("keydown", keydown, true);
    expect(remove).toHaveBeenCalledWith("pointerdown", pointerdown, true);
    add.mockRestore();
    remove.mockRestore();
  }
});
