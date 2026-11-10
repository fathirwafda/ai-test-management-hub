import { describe, expect, it } from "vitest";
import { caseNumbersIn, mapResult, mergeDuplicates, type MappingIndex } from "../../src/importers/mapping.js";
import { detectFormat } from "../../src/importers/service.js";
import type { ImportedResult } from "../../src/importers/types.js";
import { normalizeRef } from "../../src/repos/context.js";

const result = (over: Partial<ImportedResult>): ImportedResult => ({
  ref: "x#y",
  title: "y",
  group: "x",
  status: "passed",
  durationMs: 10,
  failureMessage: "",
  failureDetails: "",
  note: "",
  tags: [],
  attachments: [],
  ...over,
});

describe("normalizeRef", () => {
  it("treats separators, case and whitespace variants as the same reference", () => {
    const a = normalizeRef("e2e/cart.spec.ts#Cart › adds  a product");
    expect(normalizeRef("E2E/cart.spec.ts # cart > adds a product")).toBe(a);
    expect(normalizeRef("e2e\\cart.spec.ts#Cart > adds a product")).toBe(a);
    expect(normalizeRef("tests/test_cart.py::test_add")).toBe("tests/test_cart.py#test_add");
    expect(normalizeRef("  ")).toBeNull();
    expect(normalizeRef(null)).toBeNull();
  });
});

describe("mapResult", () => {
  const index: MappingIndex = {
    byRef: new Map([[normalizeRef("com.shop.CartTest#addsItem")!, 11]]),
    byNumber: new Map([
      [4, 40],
      [12, 120],
    ]),
  };

  it("prefers a case key in the title over the automation reference", () => {
    const m = mapResult(result({ ref: "com.shop.CartTest#addsItem", title: "addsItem [TC-12]" }), index);
    expect(m).toMatchObject({ caseId: 120, via: "key" });
  });

  it("falls back to the normalized reference", () => {
    expect(mapResult(result({ ref: "com.shop.CartTest # AddsItem", title: "AddsItem" }), index)).toMatchObject({
      caseId: 11,
      via: "ref",
    });
  });

  it("ignores keys that do not exist and reports unmapped results", () => {
    expect(mapResult(result({ ref: "a#b", title: "b TC-999" }), index)).toMatchObject({ caseId: null, via: null });
  });

  it("finds every TC key in a title", () => {
    expect(caseNumbersIn("covers TC-4 and tc-12, not TC-x")).toEqual([4, 12]);
  });
});

describe("mergeDuplicates", () => {
  it("merges results with the same reference; the worst status wins", () => {
    const merged = mergeDuplicates([
      result({ ref: "a#b", status: "passed", durationMs: 5, tags: ["x"] }),
      result({ ref: "A # b", status: "failed", durationMs: 7, failureMessage: "boom", tags: ["y"] }),
      result({ ref: "c#d", status: "skipped", durationMs: null }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ status: "failed", durationMs: 12, failureMessage: "boom", tags: ["x", "y"] });
  });
});

describe("detectFormat", () => {
  it("detects JUnit XML and Playwright JSON, and explains anything else", () => {
    expect(detectFormat('<?xml version="1.0"?><testsuites></testsuites>', "auto")).toBe("junit");
    expect(detectFormat('{"config":{},"suites":[]}', "auto")).toBe("playwright");
    expect(detectFormat("anything", "junit")).toBe("junit");
    expect(() => detectFormat('{"suites":[]}', "auto")).toThrow(/not a Playwright JSON report/);
    expect(() => detectFormat("<html></html>", "auto")).toThrow(/not a JUnit report/);
    expect(() => detectFormat("hello", "auto")).toThrow(/Unrecognised file/);
  });
});
