import type { ErrorTraceFrame } from "@spreadsheet-app/engine";
import { expect, it } from "vitest";
import { renderErrorTraceText } from "./errorTraceText";

it("renders the raised location, caller chain, and omitted-call marker", () => {
  const trace: ErrorTraceFrame[] = [
    {
      function: "Broken",
      location: {
        scriptId: "script-1",
        scriptName: "Script 1",
        line: 3,
        name: "Broken",
      },
      callSite: {
        kind: "cell",
        cell: { tableId: "t1", row: 0, col: 1 },
        tableName: "Table 1",
        parent: {
          kind: "script",
          scriptId: "script-1",
          scriptName: "Script 1",
          line: 8,
          name: "Wrapper",
          parent: { kind: "more", count: 4 },
        },
      },
    },
  ];

  expect(renderErrorTraceText(trace)).toEqual([
    "Raised in Broken (Script 1, line 3)",
    "Called from 'Table 1'!B1 → Wrapper (Script 1, line 8) → … 4 more calls",
  ]);
});
