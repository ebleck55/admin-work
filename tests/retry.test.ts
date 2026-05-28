import { describe, it, expect } from "vitest";
import { parseJson } from "@/lib/llm/retry";

describe("parseJson", () => {
  it("parses plain JSON", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips ```json fences", () => {
    expect(parseJson("```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
  });

  it("strips plain ``` fences", () => {
    expect(parseJson("```\n{\"a\":3}\n```")).toEqual({ a: 3 });
  });

  it("normalizes smart quotes", () => {
    expect(parseJson('{“key”: “value”}')).toEqual({ key: "value" });
  });

  it("extracts JSON from surrounding prose", () => {
    expect(
      parseJson("Here you go: {\"answer\": 42}. Hope that helps."),
    ).toEqual({ answer: 42 });
  });

  it("handles arrays", () => {
    expect(parseJson("[1, 2, 3]")).toEqual([1, 2, 3]);
  });
});
