import { decodeHTMLStrict } from "entities/decode";

type PublishedLinkTarget = {
  kind: "web" | "mail" | "sitePath";
  href: string;
};

/** Describes a Markdown destination without resolving it against the WebView. */
export function publishedLinkTarget(
  source: string,
): PublishedLinkTarget | null {
  const href = decodeHTMLStrict(source);
  if (!href || href !== href.trim() || /[\\\p{Cc}]/u.test(href)) return null;
  if (href.startsWith("/"))
    return href.startsWith("//") ? null : { kind: "sitePath", href };

  if (/^mailto:/iu.test(href))
    return /^mailto:\//iu.test(href) ? null : { kind: "mail", href };

  // URL also accepts ambiguous spellings such as https:/host or https:///host.
  const authority = /^https?:\/\/([^/?#]+)/iu.exec(href)?.[1];
  if (!authority || authority.includes("@")) return null;
  try {
    return { kind: "web", href: new URL(href).href };
  } catch {
    return null;
  }
}
