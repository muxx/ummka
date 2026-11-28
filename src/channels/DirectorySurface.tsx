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

export function DirectoryCompass({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5z" />
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
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M10 5v14" />
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
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
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
