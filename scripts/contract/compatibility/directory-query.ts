import type { openDirectorySearch } from "../../../src/channels/open-directory-search.ts";

type Search = ReturnType<typeof openDirectorySearch>;

// Observe the real debounced read through the public screen lifecycle.
export async function checkDirectoryQuery(search: Search, text: string) {
  let unsubscribe = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<ReturnType<Search["getSnapshot"]>>(
      (resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Directory query did not settle")),
          15_000,
        );
        unsubscribe = search.subscribe(() => {
          const state = search.getSnapshot();
          if (state.status === "loading") return;
          if (state.query === text.trim() && state.status === "ready")
            resolve(state);
          else reject(new Error(`Directory query ended with ${state.status}`));
        });
        search.setQuery(text);
      },
    );
  } finally {
    clearTimeout(timeout);
    unsubscribe();
  }
}
