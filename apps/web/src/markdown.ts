import MarkdownIt from "markdown-it";
import { isDeepLinkHref } from "./deepLinks";

/**
 * The Markdown renderer for text views and for cells that hold `MARKDOWN`.
 *
 * Raw HTML in the source is shown as text and not run: what is rendered can
 * be written by one person and read by another. markdown-it also refuses
 * link targets such as `javascript:`.
 */
export const markdown = new MarkdownIt({ html: false, linkify: true });

const validateAllowedScheme = markdown.validateLink.bind(markdown);
markdown.validateLink = (href) =>
  isDeepLinkHref(href) || (/^[a-z][a-z0-9+.-]*:/i.test(href) && validateAllowedScheme(href));

// External links open in a new tab. App links stay in this editor.
const renderLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const hrefValue = token?.attrGet("href");
  const href = typeof hrefValue === "string" ? hrefValue : "";
  if (!isDeepLinkHref(href)) {
    token?.attrSet("target", "_blank");
    token?.attrSet("rel", "noopener noreferrer");
  }
  return renderLinkOpen(tokens, index, options, env, self);
};
