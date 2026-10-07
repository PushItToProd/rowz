import sampleManifest from "../../../../samples/index.json";
import type { SpreadsheetFile } from "@spreadsheet-app/shared";
import { readSpreadsheetFile } from "./spreadsheetFile";
import { DOCUMENT_TEMPLATES } from "./templates";

export type GalleryCategory = "Templates" | "Samples";

export interface GalleryExample {
  id: string;
  title: string;
  description: string;
  category: GalleryCategory;
  document: SpreadsheetFile;
  features: string[];
}

interface SampleManifestEntry {
  id: string;
  title: string;
  description: string;
  category: "Samples";
  file: string;
}

const samples = sampleManifest as SampleManifestEntry[];
const sampleLoaders = import.meta.glob<string>(
  ["../../../../samples/*.json", "!../../../../samples/index.json"],
  { query: "?raw", import: "default" },
);

function featureBadges(document: SpreadsheetFile): string[] {
  const blocks = document.pages.flatMap((page) => page.blocks);
  const tables = blocks.filter((block) => block.type === "table");
  const contents = blocks
    .map((block) =>
      block.type === "table"
        ? [
            ...block.cells.map(({ input }) => input),
            ...(block.columns ?? []).flatMap((column) =>
              column.type === "formula" ? [column.formula] : [],
            ),
          ].join("\n")
        : block.source,
    )
    .join("\n");
  const features: string[] = [];

  if (/\b(?:CHECKBOX|DROPDOWN|TEXTBOX|NUMBERBOX)\s*\(/.test(contents)) {
    features.push("Controls");
  }
  if (
    /\b(?:BUTTON|EXECUTE|SEND_EMAIL|APPEND_ROW|INSERT|UPDATE|OVERWRITE|CLEAR|DO)\s*\(/.test(
      contents,
    )
  ) {
    features.push("Actions");
  }
  if (blocks.some((block) => block.type === "chart")) features.push("Charts");
  if (blocks.some((block) => block.type === "script")) features.push("Scripts");
  if (tables.some((table) => table.columns?.length)) features.push("Data tables");
  else if (tables.length) features.push("Tables");
  if (blocks.some((block) => block.type === "text")) features.push("Text views");
  if (
    tables.some(
      (table) =>
        table.cells.some(({ input }) => input.startsWith("=")) ||
        table.columns?.some((column) => column.type === "formula"),
    ) ||
    blocks.some(
      (block) =>
        (block.type === "chart" && block.source.trimStart().startsWith("=")) ||
        (block.type === "text" && /\{\{|\{%/.test(block.source)),
    )
  ) {
    features.push("Formulas");
  }

  return features.slice(0, 4);
}

/** Loads the built-in examples. Sample JSON files are split into lazy Vite chunks. */
export async function loadGalleryExamples(): Promise<GalleryExample[]> {
  const templates = DOCUMENT_TEMPLATES.map((template) => ({
    id: `template-${template.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
    title: template.name,
    description: template.description,
    category: "Templates" as const,
    document: template.document,
    features: featureBadges(template.document),
  }));

  const sampleExamples = await Promise.all(
    samples.map(async (sample) => {
      const path = `../../../../samples/${sample.file}`;
      const load = sampleLoaders[path];
      if (!load) throw new Error(`The sample document ${sample.file} is missing`);
      const document = readSpreadsheetFile(await load());
      return {
        ...sample,
        category: sample.category,
        document,
        features: featureBadges(document),
      };
    }),
  );

  return [...templates, ...sampleExamples];
}

/** Picks the first unused name, keeping the original title for the first copy. */
export function uniqueDocumentName(name: string, existingNames: Iterable<string>): string {
  const existing = new Set([...existingNames].map((item) => item.toLowerCase()));
  if (!existing.has(name.toLowerCase())) return name;

  let suffix = 2;
  let candidate = `${name} (${String(suffix)})`;
  while (existing.has(candidate.toLowerCase())) {
    suffix++;
    candidate = `${name} (${String(suffix)})`;
  }
  return candidate;
}
