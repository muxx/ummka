export function observeKeyboardNavigation(target: Window) {
  const root = target.document.documentElement;
  const attribute = "data-keyboard-navigation";

  function keydown(event: KeyboardEvent) {
    if (
      event.isTrusted &&
      event.key === "Tab" &&
      !event.isComposing &&
      !event.ctrlKey &&
      !event.metaKey
    )
      root.setAttribute(attribute, "");
  }
  function pointerdown(event: PointerEvent) {
    if (event.isTrusted) root.removeAttribute(attribute);
  }

  target.addEventListener("keydown", keydown, true);
  target.addEventListener("pointerdown", pointerdown, true);
  return () => {
    target.removeEventListener("keydown", keydown, true);
    target.removeEventListener("pointerdown", pointerdown, true);
    root.removeAttribute(attribute);
  };
}
