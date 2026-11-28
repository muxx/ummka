import {
  createContext,
  Fragment,
  memo,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isAndroid } from "../build-platform.ts";
import type { IntegrationCard } from "../mattermost/integration-cards.ts";
import {
  CardBodyText,
  IntegrationCardDisclosure,
} from "./IntegrationCardDisclosure.tsx";
import { CodeCopy, CodePreview } from "./PublishedCodeReader.tsx";
import {
  PublishedLinkNavigation,
  PublishedPostLink,
} from "./PublishedPostLink.tsx";
import {
  PublishedReaderWindow,
  type ReaderOrigin,
  tableCopy,
  tableOpenLabel,
} from "./PublishedReaderWindow.tsx";
import { publishedLinkTarget } from "./published-link-target.ts";
import {
  publishedEmojiPattern,
  publishedPostDocument,
} from "./published-post-document.ts";
import {
  integrationCardBody,
  integrationCardTitle,
} from "./published-post-summary.ts";
import { registerPublishedCard } from "./published-reading-history.ts";
import "./published-post.css";
import "./published-integration-card.css";

type Block = ReturnType<typeof publishedPostDocument>[number];
type Inline = Extract<Block, { kind: "paragraph" }>["children"][number];
type Locale = "en" | "ru";
const labels = {
  en: { image: "Image", task: "Task", code: "Code" },
  ru: { image: "Изображение", task: "Задача", code: "Код" },
};

function useHorizontalRegion<T extends HTMLElement>(label: string) {
  const ref = useRef<T>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // WebKit needs an explicit keyboard target for an overflowing block.
    const fit = () => setScrollable(element.scrollWidth > element.clientWidth);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const keyboardRegion = scrollable
    ? {
        role: "region",
        tabIndex: 0,
        "aria-label": label,
      }
    : undefined;
  return { ref, ...keyboardRegion };
}

function DesktopCode({
  block,
  locale,
  clipText,
}: {
  block: Extract<Block, { kind: "codeBlock" }>;
  locale: Locale;
  clipText?: boolean;
}) {
  const region = useHorizontalRegion<HTMLPreElement>(
    block.language
      ? `${labels[locale].code} (${block.language})`
      : labels[locale].code,
  );
  return (
    <div className="post-code-desktop">
      <pre {...region}>
        <code>{bodyText(block.text, clipText)}</code>
      </pre>
      <CodeCopy source={block.text} locale={locale} />
    </div>
  );
}

function MobileCode({
  block,
  locale,
}: {
  block: Extract<Block, { kind: "codeBlock" }>;
  locale: Locale;
}) {
  const origin = useContext(PostReaderOrigin);
  if (!origin) throw Error("Mobile code requires its post");
  return <CodePreview source={block} locale={locale} origin={origin} />;
}

function bodyText(text: string, clipText?: boolean) {
  return clipText ? <CardBodyText>{text}</CardBodyText> : text;
}

type EmojiLookup =
  typeof import("../mattermost/standard-emoji.ts").findStandardEmoji;
let emojiLookup: EmojiLookup | undefined;
let loadingEmoji = false;
const emojiListeners = new Set<() => void>();

function subscribeEmoji(listener: () => void) {
  if (!emojiLookup) {
    emojiListeners.add(listener);
    if (!loadingEmoji) {
      loadingEmoji = true;
      void import("../mattermost/standard-emoji.ts").then(
        ({ findStandardEmoji }) => {
          emojiLookup = findStandardEmoji;
          for (const changed of emojiListeners) changed();
          emojiListeners.clear();
        },
      );
    }
  }
  return () => emojiListeners.delete(listener);
}

function InlineEmojiText({ text }: { text: string }) {
  const findEmoji = useSyncExternalStore(subscribeEmoji, () => emojiLookup);
  return findEmoji
    ? text.replace(
        publishedEmojiPattern,
        (original, name: string) =>
          findEmoji(name.toLowerCase())?.glyph ?? original,
      )
    : text;
}

function inlineNode(
  node: Inline,
  locale: Locale,
  clipText?: boolean,
): React.ReactNode {
  switch (node.kind) {
    case "text":
      return bodyText(node.text, clipText);
    case "emojiText":
      return <InlineEmojiText text={node.text} />;
    case "code":
      return <code>{bodyText(node.text, clipText)}</code>;
    case "lineBreak":
      return <br />;
    case "imageDescription":
      return (
        <PublishedPostLink target={node.target}>
          {bodyText(node.text || labels[locale].image, clipText)}
        </PublishedPostLink>
      );
    case "emphasis":
      return <em>{inlines(node.children, locale, clipText)}</em>;
    case "strong":
      return <strong>{inlines(node.children, locale, clipText)}</strong>;
    case "strike":
      return <del>{inlines(node.children, locale, clipText)}</del>;
    case "linkLabel":
      return (
        <PublishedPostLink target={node.target}>
          {inlines(node.children, locale, clipText)}
        </PublishedPostLink>
      );
  }
}

function inlines(nodes: Inline[], locale: Locale, clipText?: boolean) {
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: Document nodes are positional and carry no identity across edits.
    <Fragment key={index}>{inlineNode(node, locale, clipText)}</Fragment>
  ));
}

type TableBlock = Extract<Block, { kind: "table" }>;
type TableProps = { table: TableBlock; locale: Locale; clipText?: boolean };
const PostReaderOrigin = createContext<ReaderOrigin | null>(null);

function TableGrid({
  table,
  locale,
  limit,
  clipText,
}: TableProps & { limit?: number }) {
  function row(cells: Inline[][], heading: boolean) {
    const Cell = heading ? "th" : "td";
    return (limit === undefined ? cells : cells.slice(0, limit)).map(
      (cell, column) => (
        <Cell
          // biome-ignore lint/suspicious/noArrayIndexKey: A cell is identified by its column.
          key={column}
          scope={heading ? "col" : undefined}
          style={{ textAlign: table.align[column] ?? undefined }}
        >
          {inlines(cell, locale, clipText)}
        </Cell>
      ),
    );
  }
  return (
    <table>
      <thead>
        <tr>{row(table.header, true)}</tr>
      </thead>
      <tbody>
        {(limit === undefined
          ? table.rows
          : table.rows.slice(0, limit - 1)
        ).map((cells, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Rows follow their authored position.
          <tr key={index}>{row(cells, false)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function InlineTable(props: TableProps) {
  const region = useHorizontalRegion<HTMLDivElement>(
    tableCopy[props.locale].title,
  );
  return (
    <div className="post-table" {...region}>
      <TableGrid {...props} />
    </div>
  );
}

function TablePreview({ table, locale, clipText }: TableProps) {
  const controls = useContext(PublishedReaderWindow);
  const origin = useContext(PostReaderOrigin);
  if (!controls || !origin)
    throw new Error("A mobile table requires its workspace and post");
  const { limit, open } = controls;
  const preview = useRef<HTMLDivElement>(null);
  const rows = table.rows.length + 1;
  const columns = useMemo(
    () =>
      table.rows.reduce(
        (n, row) => Math.max(n, row.length),
        table.header.length,
      ),
    [table],
  );
  const hasMoreRows = rows > limit;
  const hasMoreColumns = columns > limit || columns > 5;
  useLayoutEffect(() => {
    const frame = preview.current;
    const area = frame?.firstElementChild;
    const grid = area?.querySelector("table");
    if (!frame || !area || !grid) return;
    const measure = () => {
      frame.toggleAttribute(
        "data-more-columns",
        hasMoreColumns || grid.offsetWidth > area.clientWidth,
      );
      frame.toggleAttribute(
        "data-more-rows",
        hasMoreRows || grid.offsetHeight > area.clientHeight,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [hasMoreColumns, hasMoreRows]);
  return (
    <div className="post-table post-table-preview" ref={preview}>
      <div className="post-table-preview-grid">
        <PublishedLinkNavigation.Provider value={null}>
          <TableGrid
            table={table}
            locale={locale}
            limit={limit}
            clipText={clipText}
          />
        </PublishedLinkNavigation.Provider>
      </div>
      <button
        className="post-table-open"
        type="button"
        aria-label={tableOpenLabel(locale, rows, columns)}
        aria-haspopup="dialog"
        onClick={({ currentTarget: button }) => {
          button.focus({ preventScroll: true });
          open({
            kind: "table",
            ...origin,
            button,
            locale,
            content: <TableGrid table={table} locale={locale} />,
          });
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 5h5v5m0-5-6 6m-3 8H5v-5m0 5 6-6" />
        </svg>
      </button>
    </div>
  );
}

type ListBlock = Extract<Block, { kind: "list" }>;
function ListItem({
  item,
  loose,
  locale,
  clipText,
}: {
  item: ListBlock["items"][number];
  loose: boolean;
  locale: Locale;
  clipText?: boolean;
}) {
  if (item.checked === null)
    return <li>{blocks(item.blocks, locale, { tight: !loose, clipText })}</li>;
  const first = item.blocks[0];
  const hasLabel = first?.kind === "paragraph" && first.children.length > 0;
  const Paragraph = loose ? "p" : Fragment;
  return (
    <li className="post-task">
      <Paragraph>
        <label>
          <input
            type="checkbox"
            checked={item.checked}
            disabled
            aria-label={hasLabel ? undefined : labels[locale].task}
          />
          {hasLabel && inlines(first.children, locale, clipText)}
        </label>
      </Paragraph>
      {blocks(hasLabel ? item.blocks.slice(1) : item.blocks, locale, {
        tight: !loose,
        clipText,
      })}
    </li>
  );
}

const headings = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
function blockNode(
  block: Block,
  locale: Locale,
  clipText?: boolean,
): React.ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <p>{inlines(block.children, locale, clipText)}</p>;
    case "heading": {
      const Heading = headings[block.level - 1];
      return <Heading>{inlines(block.children, locale, clipText)}</Heading>;
    }
    case "quote":
      return (
        <blockquote>{blocks(block.blocks, locale, { clipText })}</blockquote>
      );
    case "table":
      return isAndroid ? (
        <TablePreview table={block} locale={locale} clipText={clipText} />
      ) : (
        <InlineTable table={block} locale={locale} clipText={clipText} />
      );
    case "codeBlock":
      return isAndroid ? (
        <MobileCode block={block} locale={locale} />
      ) : (
        <DesktopCode block={block} locale={locale} clipText={clipText} />
      );
    case "rule":
      return <hr />;
    case "literal":
      return (
        <div className="post-literal">{bodyText(block.text, clipText)}</div>
      );
    case "list": {
      const children = block.items.map((item, index) => (
        <ListItem
          // biome-ignore lint/suspicious/noArrayIndexKey: The ordered document already owns each item's position.
          key={index}
          item={item}
          loose={block.loose}
          locale={locale}
          clipText={clipText}
        />
      ));
      const className = block.loose ? "post-loose-list" : undefined;
      return block.start === null ? (
        <ul className={className}>{children}</ul>
      ) : (
        <ol start={block.start} className={className}>
          {children}
        </ol>
      );
    }
  }
}
function blocks(
  nodes: Block[],
  locale: Locale,
  { tight, clipText }: { tight?: boolean; clipText?: boolean } = {},
) {
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: The ordered document already owns each block's position.
    <Fragment key={index}>
      {tight && node.kind === "paragraph"
        ? inlines(node.children, locale, clipText)
        : blockNode(node, locale, clipText)}
    </Fragment>
  ));
}

const cardLabel = {
  en: (index: number, count: number) => `card ${index + 1} of ${count}`,
  ru: (index: number, count: number) => `карточка ${index + 1} из ${count}`,
};

function CardFields({
  fields,
  locale,
}: {
  fields: IntegrationCard["fields"];
  locale: Locale;
}) {
  const paired = new Set<number>();
  for (let index = 0; index < fields.length - 1; index++)
    if (fields[index].short && fields[index + 1].short) {
      paired.add(index);
      paired.add(++index);
    }
  return (
    <dl className="published-card-fields">
      {fields.map((field, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: Fields have authored order and no server ID.
          key={index}
          data-paired={paired.has(index) || undefined}
          data-published-card-part={`field-${index}`}
        >
          <dt>{field.title}</dt>
          <dd>
            {field.value &&
              blocks(publishedPostDocument({ message: field.value }), locale)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PublishedIntegrationCard({
  card,
  index,
  count,
  locale,
}: {
  card: IntegrationCard;
  index: number;
  count: number;
  locale: Locale;
}) {
  const pretext = card.pretext?.trim();
  const author = card.authorName?.trim();
  const title = integrationCardTitle(card);
  const body = integrationCardBody(card);
  const footer = card.footer?.trim();
  const fields = card.fields.filter(
    (field) => field.title?.trim() || field.value?.trim(),
  );
  const color =
    card.color && /^#[a-f\d]{6}$/iu.test(card.color) ? card.color : undefined;
  return (
    <>
      {pretext && <p className="published-card-pretext">{pretext}</p>}
      {(author || title || body.visible || fields.length > 0 || footer) && (
        <div
          className="published-integration-card"
          data-published-card={index}
          ref={(node) => {
            if (node) registerPublishedCard(node, card);
          }}
          data-published-disclosure=""
          style={color ? { borderInlineStartColor: color } : undefined}
        >
          {author && (
            <div
              className="published-card-author"
              data-published-card-part="author"
            >
              <PublishedPostLink
                target={publishedLinkTarget(card.authorLink ?? "")}
              >
                {author}
              </PublishedPostLink>
            </div>
          )}
          {title && (
            <h3
              className="published-integration-card-title"
              data-published-card-part="title"
            >
              <PublishedPostLink
                target={publishedLinkTarget(card.titleLink ?? "")}
              >
                {title}
              </PublishedPostLink>
            </h3>
          )}
          <IntegrationCardDisclosure
            locale={locale}
            label={title || cardLabel[locale](index, count)}
            fields={
              fields.length ? (
                <CardFields fields={fields} locale={locale} />
              ) : undefined
            }
            footer={footer}
          >
            {body.visible
              ? blocks(body.blocks, locale, { clipText: true })
              : undefined}
          </IntegrationCardDisclosure>
        </div>
      )}
    </>
  );
}

export const PublishedPostCards = memo(function PublishedPostCards({
  cards,
  locale,
  authorName,
  inThread,
}: {
  cards: readonly IntegrationCard[];
  locale: Locale;
} & ReaderOrigin) {
  return (
    <PostReaderOrigin value={{ authorName, inThread }}>
      <div className="published-post published-post-cards">
        {cards.map((card, index) => (
          <PublishedIntegrationCard
            // biome-ignore lint/suspicious/noArrayIndexKey: The server orders cards and supplies no identity across edits.
            key={index}
            card={card}
            index={index}
            count={cards.length}
            locale={locale}
          />
        ))}
      </div>
    </PostReaderOrigin>
  );
});

export const PublishedPostBody = memo(function PublishedPostBody({
  message,
  inlineEmoji,
  locale,
  authorName,
  inThread,
}: {
  message: string;
  inlineEmoji?: boolean;
  locale: Locale;
} & ReaderOrigin) {
  const document = useMemo(
    () => publishedPostDocument({ message, inlineEmoji }),
    [message, inlineEmoji],
  );
  if (!document.length) return null;
  return (
    <PostReaderOrigin value={{ authorName, inThread }}>
      <div className="published-post">{blocks(document, locale)}</div>
    </PostReaderOrigin>
  );
});
