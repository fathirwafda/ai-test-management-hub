import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksLikePlaywright, parsePlaywrightJson } from "../../src/importers/playwright.js";
import { ImportFormatError } from "../../src/importers/types.js";

const report = readFileSync(new URL("../fixtures/playwright-report.json", import.meta.url), "utf8");

describe("parsePlaywrightJson", () => {
  const results = parsePlaywrightJson(report);
  const byTitle = Object.fromEntries(results.map((r) => [r.title, r]));

  it("produces one result per spec with file#Describe > title references", () => {
    expect(results.map((r) => r.ref)).toEqual([
      "e2e/checkout.spec.ts#Checkout > pays with a saved card",
      "e2e/checkout.spec.ts#Checkout > shows an error for an expired discount code",
      "e2e/cart.spec.ts#Cart > adds a product from the product page",
      "e2e/cart.spec.ts#Cart > saves the cart for later [TC-14]",
    ]);
  });

  it("sums durations across projects and keeps tags without the @", () => {
    expect(byTitle["Checkout > pays with a saved card"]).toMatchObject({
      status: "passed",
      durationMs: 14800 + 15950,
      tags: ["smoke"],
    });
  });

  it("lets the worst project outcome win and strips ANSI colours from errors", () => {
    const r = byTitle["Checkout > shows an error for an expired discount code"]!;
    expect(r.status).toBe("failed");
    expect(r.failureMessage).toBe("TimeoutError: locator.click: Timeout 30000ms exceeded.");
    expect(r.failureMessage).not.toContain("\u001b");
    expect(r.note).toContain("chromium: failed");
    expect(r.note).toContain("webkit: passed");
  });

  it("records attachment paths as metadata and ignores inline bodies", () => {
    const r = byTitle["Checkout > shows an error for an expired discount code"]!;
    expect(r.attachments).toEqual([
      {
        name: "chromium: screenshot",
        contentType: "image/png",
        path: "/repo/test-results/checkout-expired-chromium/test-failed-1.png",
      },
      {
        name: "chromium: trace",
        contentType: "application/zip",
        path: "/repo/test-results/checkout-expired-chromium/trace.zip",
      },
    ]);
  });

  it("records flaky tests as passed with a note", () => {
    const r = byTitle["Cart > adds a product from the product page"]!;
    expect(r.status).toBe("passed");
    expect(r.note).toMatch(/flaky, passed on retry 1/);
  });

  it("maps skipped tests to skipped", () => {
    expect(byTitle["Cart > saves the cart for later [TC-14]"]).toMatchObject({ status: "skipped", tags: ["wip"] });
  });

  it("detects the format and rejects other JSON", () => {
    expect(looksLikePlaywright(JSON.parse(report))).toBe(true);
    expect(looksLikePlaywright({ suites: [] })).toBe(false);
    expect(() => parsePlaywrightJson('{"suites": "nope"}')).toThrow(ImportFormatError);
    expect(() => parsePlaywrightJson("{not json")).toThrow(/Invalid JSON/);
  });
});
