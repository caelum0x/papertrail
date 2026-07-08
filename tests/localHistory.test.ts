import { describe, it, expect } from "vitest";
import { mergeHistory } from "../lib/localHistory";

describe("mergeHistory", () => {
  it("adds a claim to an empty history", () => {
    expect(mergeHistory([], "Drug X reduced events by 30%")).toEqual([
      "Drug X reduced events by 30%",
    ]);
  });

  it("places the newest claim first", () => {
    const result = mergeHistory(["older claim"], "newer claim");
    expect(result).toEqual(["newer claim", "older claim"]);
  });

  it("dedupes an exact repeat and moves it to the front", () => {
    const result = mergeHistory(["a", "b", "c"], "b");
    expect(result).toEqual(["b", "a", "c"]);
  });

  it("dedupes case-insensitively", () => {
    const result = mergeHistory(["Drug X reduced events"], "drug x reduced events");
    expect(result).toEqual(["drug x reduced events"]);
    expect(result).toHaveLength(1);
  });

  it("dedupes ignoring surrounding whitespace", () => {
    const result = mergeHistory(["claim one"], "  claim one  ");
    expect(result).toEqual(["claim one"]);
    expect(result).toHaveLength(1);
  });

  it("caps the history to the default of 10", () => {
    const existing = Array.from({ length: 12 }, (_, i) => `claim ${i}`);
    const result = mergeHistory(existing, "fresh");
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("fresh");
  });

  it("honors a custom cap", () => {
    const result = mergeHistory(["a", "b", "c"], "d", 2);
    expect(result).toEqual(["d", "a"]);
  });

  it("trims the stored claim", () => {
    expect(mergeHistory([], "  spaced  ")).toEqual(["spaced"]);
  });

  it("ignores an empty/whitespace-only claim but still caps existing", () => {
    const existing = ["a", "b", "c"];
    expect(mergeHistory(existing, "   ")).toEqual(existing);
    expect(mergeHistory(existing, "", 2)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const existing = ["a", "b"];
    const copy = [...existing];
    mergeHistory(existing, "c");
    expect(existing).toEqual(copy);
  });

  it("returns an empty array when cap is 0", () => {
    expect(mergeHistory(["a"], "b", 0)).toEqual([]);
  });
});
