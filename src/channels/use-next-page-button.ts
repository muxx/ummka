import { useEffect, useEffectEvent, useRef } from "react";

export function useNextPageButton(
  next: number | null,
  read: (page: number, button: HTMLButtonElement) => void,
) {
  const boundary = useRef<HTMLButtonElement>(null);
  const load = useEffectEvent(read);
  useEffect(() => {
    const button = boundary.current;
    if (next === null || !button) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio > 0,
          )
        ) {
          observer.disconnect();
          load(next, button);
        }
      },
      { root: button.parentElement },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, [next]);
  return boundary;
}
