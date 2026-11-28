import type { ComponentProps, RefObject } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { DirectoryChannelIcon } from "./DirectoryChannelIcon.tsx";
import "./channel-directory.css";

export const directoryCopy = {
  en: {
    title: "Directory",
    joined: "My channels",
    find: "Find a channel",
    public: "Public channel",
    private: "Private channel",
    archived: "Archived",
    noMatches: "No matching channels",
    changeQuery: "Change your search.",
    changeQueryOrTab: "Change your search or switch tabs.",
  },
  ru: {
    title: "Каталог",
    joined: "Мои каналы",
    find: "Найти канал",
    public: "Открытый канал",
    private: "Закрытый канал",
    archived: "В архиве",
    noMatches: "Совпадений нет",
    changeQuery: "Измените запрос.",
    changeQueryOrTab: "Измените запрос или вкладку.",
  },
} as const;

// Tabler glyphs shared with the interactive directory prototype.
export function DirectoryCompass({ size = 16 }: { size?: number }) {
  return (
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
      <path d="M8 16l2 -6l6 -2l-2 6l-6 2 M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 3v2 M12 19v2 M3 12h2 M19 12h2" />
    </svg>
  );
}

export function DirectoryHeading({
  id,
  heading,
  title,
  teamName,
}: {
  id: string;
  heading: RefObject<HTMLHeadingElement | null>;
  title: string;
  teamName: string;
}) {
  return (
    <div className="directory-heading">
      <div>
        <DirectoryCompass size={21} />
        <h1 id={id} ref={heading} tabIndex={-1}>
          {title}
        </h1>
      </div>
      <p title={teamName}>{teamName}</p>
    </div>
  );
}

export function DirectoryNavigationIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12 M9 4v16" />
    </svg>
  );
}

function SearchMark({ size = 18 }: { size?: number }) {
  return (
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
      <path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M21 21l-6 -6" />
    </svg>
  );
}

export function DirectorySearch({
  language,
  ...input
}: Pick<ComponentProps<"input">, "ref" | "value" | "onChange" | "disabled"> & {
  language: EntryLanguage;
}) {
  const label = directoryCopy[language].find;
  return (
    <div className="directory-search">
      <SearchMark />
      <input
        {...input}
        className="directory-filter"
        type="search"
        aria-label={label}
        placeholder={label}
      />
    </div>
  );
}

export function DirectoryEmpty({
  title,
  hint,
  kind,
}: {
  title: string;
  hint: string;
  kind: "search" | "channels";
}) {
  return (
    <div className="directory-empty" role="status">
      {kind === "search" ? (
        <SearchMark size={27} />
      ) : (
        <DirectoryChannelIcon kind="public" size={27} />
      )}
      <h3>{title}</h3>
      <p>{hint}</p>
    </div>
  );
}
