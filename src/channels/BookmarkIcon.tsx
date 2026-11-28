export function BookmarkIcon({
  kind = "bookmark",
}: {
  kind?: "back" | "bookmark" | "link" | "open" | "close" | "edit" | "delete";
}) {
  const path = {
    back: "M19 12H5m6-6-6 6 6 6",
    edit: "m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z",
    delete: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
    bookmark: "M18 7v14l-6-4-6 4V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4",
    link: "M10 13a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1.8 1.8M14 11a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7l1.8-1.8",
    open: "M6 18 18 6M6 6h12v12",
    close: "m6 6 12 12m0-12L6 18",
  }[kind];
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
