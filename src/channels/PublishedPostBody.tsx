import {
  createContext,
  Fragment,
  memo,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isAndroid } from "../build-platform.ts";
import {
  PublishedLinkNavigation,
  PublishedPostLink,
} from "./PublishedPostLink.tsx";
import {
  PublishedTableWindow,
  type TableOrigin,
  tableCopy,
  tableOpenLabel,
} from "./PublishedTableWindow.tsx";
import { publishedPostDocument } from "./published-post-document.ts";
import "./published-post.css";

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

function PostCode({
  block,
  locale,
}: {
  block: Extract<Block, { kind: "codeBlock" }>;
  locale: Locale;
}) {
  const region = useHorizontalRegion<HTMLPreElement>(
    block.language
      ? `${labels[locale].code} (${block.language})`
      : labels[locale].code,
  );
  return (
    <pre {...region}>
      <code>{block.text}</code>
    </pre>
  );
}

function inlineNode(node: Inline, locale: Locale): React.ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "code":
      return <code>{node.text}</code>;
    case "lineBreak":
      return <br />;
    case "imageDescription":
      return (
        <PublishedPostLink target={node.target}>
          {node.text || labels[locale].image}
        </PublishedPostLink>
      );
    case "emphasis":
      return <em>{inlines(node.children, locale)}</em>;
    case "strong":
      return <strong>{inlines(node.children, locale)}</strong>;
    case "strike":
      return <del>{inlines(node.children, locale)}</del>;
    case "linkLabel":
      return (
        <PublishedPostLink target={node.target}>
          {inlines(node.children, locale)}
        </PublishedPostLink>
      );
  }
}

function inlines(nodes: Inline[], locale: Locale) {
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: Document nodes are positional and carry no identity across edits.
    <Fragment key={index}>{inlineNode(node, locale)}</Fragment>
  ));
}

type TableBlock = Extract<Block, { kind: "table" }>;
type TableProps = { table: TableBlock; locale: Locale };
const PostTableOrigin = createContext<TableOrigin | null>(null);

function TableGrid({ table, locale, limit }: TableProps & { limit?: number }) {
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
          {inlines(cell, locale)}
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

function TablePreview({ table, locale }: TableProps) {
  const controls = useContext(PublishedTableWindow);
  const origin = useContext(PostTableOrigin);
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
          <TableGrid table={table} locale={locale} limit={limit} />
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
}: {
  item: ListBlock["items"][number];
  loose: boolean;
  locale: Locale;
}) {
  if (item.checked === null)
    return <li>{blocks(item.blocks, locale, !loose)}</li>;
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
          {hasLabel && inlines(first.children, locale)}
        </label>
      </Paragraph>
      {blocks(hasLabel ? item.blocks.slice(1) : item.blocks, locale, !loose)}
    </li>
  );
}

const headings = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
function blockNode(block: Block, locale: Locale): React.ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <p>{inlines(block.children, locale)}</p>;
    case "heading": {
      const Heading = headings[block.level - 1];
      return <Heading>{inlines(block.children, locale)}</Heading>;
    }
    case "quote":
      return <blockquote>{blocks(block.blocks, locale)}</blockquote>;
    case "table":
      return isAndroid ? (
        <TablePreview table={block} locale={locale} />
      ) : (
        <InlineTable table={block} locale={locale} />
      );
    case "codeBlock":
      return <PostCode block={block} locale={locale} />;
    case "rule":
      return <hr />;
    case "literal":
      return <div className="post-literal">{block.text}</div>;
    case "list": {
      const children = block.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: The ordered document already owns each item's position.
        <ListItem key={index} item={item} loose={block.loose} locale={locale} />
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
function blocks(nodes: Block[], locale: Locale, tight = false) {
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: The ordered document already owns each block's position.
    <Fragment key={index}>
      {tight && node.kind === "paragraph"
        ? inlines(node.children, locale)
        : blockNode(node, locale)}
    </Fragment>
  ));
}

export const PublishedPostBody = memo(function PublishedPostBody({
  message,
  locale,
  authorName,
  inThread,
}: {
  message: string;
  locale: Locale;
} & TableOrigin) {
  const document = useMemo(() => publishedPostDocument({ message }), [message]);
  return (
    <PostTableOrigin value={{ authorName, inThread }}>
      <div className="published-post">{blocks(document, locale)}</div>
    </PostTableOrigin>
  );
});
