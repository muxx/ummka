import { PrivateChannelIcon } from "./PrivateChannelIcon.tsx";

export function DirectoryChannelIcon({
  kind,
  size = 18,
}: {
  kind: "public" | "private" | "archived";
  size?: number;
}) {
  return (
    <span className="directory-kind" aria-hidden="true">
      {kind === "private" ? (
        <PrivateChannelIcon />
      ) : (
        <svg
          aria-hidden="true"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
        >
          {kind === "archived" ? (
            <>
              <rect x="3" y="4" width="18" height="4" rx="2" />
              <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" />
            </>
          ) : (
            <path d="M5 9h14M5 15h14M11 4 7 20M17 4l-4 16" />
          )}
        </svg>
      )}
    </span>
  );
}
