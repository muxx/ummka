export function showPostArrival(row: HTMLElement) {
  const reducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  row.setAttribute("data-post-arrival", "");
  const clear = () => {
    window.clearTimeout(timer);
    row.removeAttribute("data-post-arrival");
  };
  const timer = window.setTimeout(clear, reducedMotion ? 4000 : 1900);
  return clear;
}
