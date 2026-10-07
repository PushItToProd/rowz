import { describe, expect, it } from "vitest";
import { uniqueDocumentName } from "./gallery";

describe("uniqueDocumentName", () => {
  it("keeps the original name when it is available", () => {
    expect(uniqueDocumentName("Invoice", ["Budget"])).toBe("Invoice");
  });

  it("uses the first free numbered name, ignoring case", () => {
    expect(uniqueDocumentName("Invoice", ["invoice", "Invoice (2)", "Invoice (4)"])).toBe(
      "Invoice (3)",
    );
  });
});
