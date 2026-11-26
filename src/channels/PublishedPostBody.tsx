import {
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { publishedPostDocument } from "./published-post-document.ts";
import "./published-post.css";

type Block = ReturnType<typeof publishedPostDocument>[number];
type Inline = Extract<Block, { kind: "paragraph" }>["children"][number];
type Locale = "en" | "ru";
const labels = {
  en: { image: "Image", task: "Task", code: "Code" },
  ru: { image: "Изображение", task: "Задача", code: "Код" },
};

function PostCode({
  block,
  locale,
}: {
  block: Extract<Block, { kind: "codeBlock" }>;
  locale: Locale;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const pre = ref.current;
    if (!pre) return;
    // WebKit needs an explicit keyboard target to scroll overflowing code.
    const fit = () => setScrollable(pre.scrollWidth > pre.clientWidth);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(pre);
    if (pre.firstElementChild) observer.observe(pre.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const keyboardRegion = scrollable
    ? {
        role: "region",
        tabIndex: 0,
        "aria-label": block.language
          ? `${labels[locale].code} (${block.language})`
          : labels[locale].code,
      }
    : undefined;
  return (
    <pre ref={ref} {...keyboardRegion}>
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
      return node.text || labels[locale].image;
    case "emphasis":
      return <em>{inlines(node.children, locale)}</em>;
    case "strong":
      return <strong>{inlines(node.children, locale)}</strong>;
    case "strike":
      return <del>{inlines(node.children, locale)}</del>;
    case "linkLabel":
      return inlines(node.children, locale);
  }
}

function inlines(nodes: Inline[], locale: Locale) {
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: Document nodes are positional and carry no identity across edits.
    <Fragment key={index}>{inlineNode(node, locale)}</Fragment>
  ));
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
}: {
  message: string;
  locale: Locale;
}) {
  const document = useMemo(() => publishedPostDocument({ message }), [message]);
  return <div className="published-post">{blocks(document, locale)}</div>;
});
