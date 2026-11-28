import { channelKindIconPaths } from "./channel-kind-icon-paths.ts";

const marks = { public: "hash", private: "lock", archived: "archive" } as const;

export function DirectoryChannelIcon({
  kind,
  size = 18,
}: {
  kind: "public" | "private" | "archived";
  size?: number;
}) {
  return (
    <span className="directory-kind" aria-hidden="true">
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={channelKindIconPaths[marks[kind]]} />
      </svg>
    </span>
  );
}
