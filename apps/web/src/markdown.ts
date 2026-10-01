import MarkdownIt from "markdown-it";

/**
 * The Markdown renderer for text views and for cells that hold `MARKDOWN`.
 *
 * Raw HTML in the source is shown as text and not run: what is rendered can
 * be written by one person and read by another. markdown-it also refuses
 * link targets such as `javascript:`.
 */
export const markdown = new MarkdownIt({ html: false, linkify: true });

// A link opens in a new tab, so following one does not leave the spreadsheet.
const renderLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]?.attrSet("target", "_blank");
  tokens[index]?.attrSet("rel", "noopener noreferrer");
  return renderLinkOpen(tokens, index, options, env, self);
};
