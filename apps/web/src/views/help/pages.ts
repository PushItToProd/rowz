export const HELP_PAGES = [
  { id: "editing", title: "Editing cells", sections: ["basics", "filling", "find"] },
  { id: "tables", title: "Pages and tables", sections: ["structure", "columns"] },
  {
    id: "formulas",
    title: "Writing formulas",
    sections: ["references", "operators", "names", "arrays"],
  },
  { id: "functions", title: "Function reference", sections: ["functions"] },
  { id: "queries", title: "Queries", sections: ["query"] },
  { id: "actions", title: "Buttons and controls", sections: ["actions", "controls"] },
  {
    id: "presentation",
    title: "Formats, charts, and text",
    sections: ["formats", "conditional", "charts", "text-views"],
  },
  {
    id: "documents",
    title: "Managing documents and errors",
    sections: ["sharing", "history", "files", "errors"],
  },
] as const;
