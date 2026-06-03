import { describe, it, expect } from "vitest";
import { dropIneligible } from "@/lib/llm/safety";

type Row = { id: string; sensitivity: "public" | "internal" | "private_dm" };

const rows: Row[] = [
  { id: "a", sensitivity: "public" },
  { id: "b", sensitivity: "internal" },
  { id: "c", sensitivity: "private_dm" },
];

describe("dropIneligible (Tier-3 fail-closed gate)", () => {
  it("drops private_dm rows from shareable artifacts", () => {
    const { kept, dropped } = dropIneligible(rows, { shareable: true });
    expect(kept.map((r) => r.id)).toEqual(["a", "b"]);
    expect(dropped.map((r) => r.id)).toEqual(["c"]);
  });

  it("keeps everything for non-shareable artifacts", () => {
    const { kept, dropped } = dropIneligible(rows, { shareable: false });
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
  });

  it("treats missing/null sensitivity as eligible", () => {
    const { kept } = dropIneligible(
      [{ id: "x" }, { id: "y", sensitivity: null }] as Array<{
        id: string;
        sensitivity?: Row["sensitivity"] | null;
      }>,
      { shareable: true },
    );
    expect(kept).toHaveLength(2);
  });
});
