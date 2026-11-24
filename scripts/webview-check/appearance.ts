import "../../src/appearance/base.css";
import { startAppearance } from "../../src/appearance/device";
import { auroraColors } from "../../src/appearance/palette";

export function checkAppearance() {
  const phase = sessionStorage.getItem("appearance-check");
  if (phase === "done") return false;
  const controller = startAppearance(window);
  const root = document.documentElement;
  try {
    if (phase === "reload") {
      if (
        controller.settings.appearance !== "dark" ||
        getComputedStyle(root).backgroundColor !== "rgb(18, 26, 37)" ||
        getComputedStyle(root).getPropertyValue("--notification").trim() !==
          "#eeddcc"
      ) {
        throw Error("appearance-restore");
      }
      controller.setAppearance("system");
      if (
        root.style.colorScheme !==
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      ) {
        throw Error("appearance-system");
      }
      sessionStorage.setItem("appearance-check", "done");
      return false;
    }
    const scroller = document.createElement("div");
    const input = document.createElement("textarea");
    scroller.style.height = "40px";
    scroller.style.overflow = "auto";
    input.style.height = "200px";
    scroller.append(input);
    document.body.append(scroller);
    controller.setAppearance("light");
    if (getComputedStyle(root).backgroundColor !== "rgb(255, 255, 255)")
      throw Error("appearance-light");
    input.value = "Черновик";
    input.focus();
    input.setSelectionRange(1, 4);
    scroller.scrollTop = 48;
    controller.setColors("dark", {
      ...auroraColors.dark,
      notification: "#eeddcc",
    });
    controller.setAppearance("dark");
    if (
      getComputedStyle(root).color !== "rgb(232, 237, 243)" ||
      input !== document.activeElement ||
      input.value !== "Черновик" ||
      input.selectionStart !== 1 ||
      input.selectionEnd !== 4 ||
      scroller.scrollTop !== 48
    )
      throw Error("appearance-interrupted-input");
    scroller.remove();
    sessionStorage.setItem("appearance-check", "reload");
    location.reload();
    return true;
  } finally {
    controller.dispose();
  }
}
