import type { EntryLanguage } from "../entry/language.ts";
import type { JoinedTeam } from "../mattermost/joined-teams.ts";
import { searchCopy } from "./search-copy.ts";

export function SearchScopeSelect({
  teams,
  team,
  scope,
  language,
  disabled,
  change,
}: {
  teams: readonly JoinedTeam[];
  team: JoinedTeam;
  scope: JoinedTeam | null;
  language: EntryLanguage;
  disabled?: boolean;
  change: (scope: JoinedTeam | null) => void;
}) {
  const text = searchCopy[language];
  return (
    <label className="search-scope">
      <span>{text.scope}</span>
      <select
        value={scope?.id ?? ""}
        disabled={disabled}
        onChange={(event) => {
          change(
            teams.find((option) => option.id === event.currentTarget.value) ??
              null,
          );
        }}
      >
        {scope && !teams.some(({ id }) => id === scope.id) && (
          <option value={scope.id} disabled>
            {scope.displayName || scope.name} · {text.teamUnavailable}
          </option>
        )}
        {teams.map((option) => {
          const name = option.displayName || option.name;
          return (
            <option key={option.id} value={option.id}>
              {option.id === team.id ? text.currentScope(name) : name}
            </option>
          );
        })}
        <option value="">{text.all}</option>
      </select>
    </label>
  );
}

export function SearchScopeNote({
  removed,
  language,
}: {
  removed: readonly string[];
  language: EntryLanguage;
}) {
  return (
    <p role="status" className="search-scope-note">
      {searchCopy[language].scopeReset(
        new Intl.ListFormat(language).format(removed),
      )}
    </p>
  );
}
