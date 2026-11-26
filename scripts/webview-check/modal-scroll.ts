export function checkModalScroll(field: HTMLElement) {
  const shell = field.closest("dialog");
  const body = field.closest<HTMLElement>(".modal-scroll");
  const head = shell?.querySelector("header");
  if (!shell || !body || !head) throw Error("Missing dialog scroll layout");
  const previousHeight = shell.style.maxHeight;
  const previousTop = body.scrollTop;
  try {
    const headerHeight =
      head.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
    const paddingBottom = Number.parseFloat(
      getComputedStyle(shell).paddingBottom,
    );
    shell.style.maxHeight = `${headerHeight + paddingBottom + field.offsetHeight / 2}px`;
    const headerBottom = head.getBoundingClientRect().bottom;
    body.scrollTop = body.scrollHeight;
    if (
      body.scrollTop <= 0 ||
      shell.scrollTop !== 0 ||
      Math.abs(head.getBoundingClientRect().bottom - headerBottom) > 1 ||
      body.getBoundingClientRect().top < headerBottom - 1
    )
      throw Error("The search dialog must scroll below its header");
  } finally {
    shell.style.maxHeight = previousHeight;
    body.scrollTop = previousTop;
  }
}
