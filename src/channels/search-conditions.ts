type Flag = "in" | "channel" | "from" | "on" | "before" | "after" | "ext";

export type SearchCondition = {
  key: Flag | "word";
  value: string;
  excluded: boolean;
  start: number;
  end: number;
};

// Mattermost splits quoted phrases before reading flags. Keep the original
// spans so removing a condition never edits quoted text or another occurrence.
export function searchConditions(terms: string): SearchCondition[] {
  const words = Array.from(terms.matchAll(/-?"[^"]*"?|[^\s"]+/g));
  const items: SearchCondition[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const [raw] = word;
    const flag = /^(-?)(in|channel|from|on|before|after|ext):(.*)$/i.exec(raw);
    if (flag) {
      const next = flag[3] ? undefined : words[index + 1];
      const value = flag[3] || next?.[0];
      if (value) {
        items.push({
          key: flag[2].toLowerCase() as Flag,
          value: value.replace(/^"|"$/g, ""),
          excluded: flag[1] === "-",
          start: word.index,
          end: next ? next.index + next[0].length : word.index + raw.length,
        });
        if (next) index++;
      }
    } else if (raw.startsWith("-") && raw.length > 1) {
      items.push({
        key: "word",
        value: raw.slice(1).replace(/^"|"$/g, ""),
        excluded: true,
        start: word.index,
        end: word.index + raw.length,
      });
    }
  }
  return items;
}

export function removeSearchConditions(
  terms: string,
  removed: readonly SearchCondition[],
) {
  for (const condition of [...removed].reverse()) {
    const left = terms.slice(0, condition.start).trimEnd();
    const right = terms.slice(condition.end).trimStart();
    terms = left && right ? left + " " + right : left + right;
  }
  return terms;
}

export function changeSearchScope(terms: string) {
  const removed = searchConditions(terms).filter(
    ({ key }) => key === "in" || key === "channel" || key === "from",
  );
  return {
    terms: removeSearchConditions(terms, removed),
    removed: removed.map(({ start, end }) => terms.slice(start, end)),
  };
}
