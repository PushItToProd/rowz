import { expect, it } from "vitest";
import { markdown } from "./markdown";

it("allows only app page and location links among relative URLs", () => {
  const html = markdown.render(
    "[page](/s/s1/p/p1) [block](#block=b1) [cell](#cell=t1.r1.c1) " +
      "[heading](#heading) [relative](other/page) [protocol-relative](//evil.example) " +
      "[script](javascript:alert(1)) [data](data:text/html,hello)",
  );

  expect(html).toContain('href="/s/s1/p/p1"');
  expect(html).toContain('href="#block=b1"');
  expect(html).toContain('href="#cell=t1.r1.c1"');
  expect(html).not.toContain('href="#heading"');
  expect(html).not.toContain('href="other/page"');
  expect(html).not.toContain('href="//evil.example"');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="data:');
});

it("keeps raw HTML disabled and preserves the existing allowed link schemes", () => {
  const html = markdown.render(
    '<img src=x onerror="alert(1)"> [web](https://example.com) [mail](mailto:a@example.com)',
  );

  expect(html).not.toContain("<img");
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('href="mailto:a@example.com"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
});
