import { useEffectEvent, useLayoutEffect, useRef } from "react";

export function useNextPageButton(
  next: number | null,
  read: (page: number, button: HTMLButtonElement) => void,
  fromOutside = false,
) {
  const boundary = useRef<HTMLButtonElement>(null);
  const load = useEffectEvent(read);
  useLayoutEffect(() => {
    const button = boundary.current;
    if (next === null || !button) return;
    let active = true;
    let approached = !fromOutside;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => !entry.isIntersecting)) approached = true;
        if (
          approached &&
          active &&
          boundary.current === button &&
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio > 0,
          )
        ) {
          active = false;
          observer.disconnect();
          load(next, button);
        }
      },
      { root: button.parentElement },
    );
    observer.observe(button);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [next, fromOutside]);
  return boundary;
}
