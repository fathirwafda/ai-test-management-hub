import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksLikeJUnit, parseJUnit } from "../../src/importers/junit.js";
import { ImportFormatError } from "../../src/importers/types.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("parseJUnit", () => {
  it("parses a Maven Surefire report (REST Assured) with failures, errors, skips and flaky reruns", () => {
    const results = parseJUnit(fixture("junit-surefire-restassured.xml"));
    expect(results).toHaveLength(6);

    const byName = Object.fromEntries(results.map((r) => [r.title, r]));
    expect(byName.addsItemAndRecalculatesTotal).toMatchObject({
      ref: "com.larkspur.api.CartApiTest#addsItemAndRecalculatesTotal",
      status: "passed",
      durationMs: 931,
      group: "com.larkspur.api.CartApiTest",
    });

    const failed = byName.rejectsExpiredDiscountCode!;
    expect(failed.status).toBe("failed");
    // Entities in attributes and text are decoded.
    expect(failed.failureMessage).toBe("1 expectation failed.\nExpected status code <422> but was <200>.");
    expect(failed.failureDetails).toContain("CartApiTest.java:88");
    expect(failed.failureDetails).toContain("--- system-out ---\nPOST /cart/discount code=SPRING23 -> 200 OK");

    expect(byName.placesOrderWithSavedCard).toMatchObject({ status: "failed", durationMs: 30050 });
    expect(byName.placesOrderWithSavedCard!.failureMessage).toMatch(/Connection refused/);

    expect(byName.refundsPartialOrder).toMatchObject({ status: "skipped", note: "Refunds are disabled on staging" });
    expect(byName.appliesValidDiscountCode!.status).toBe("passed");
    expect(byName.appliesValidDiscountCode!.note).toMatch(/Passed on rerun after 1 flaky failure/);
  });

  it("parses a single-testsuite pytest report", () => {
    const results = parseJUnit(fixture("junit-pytest.xml"));
    expect(results.map((r) => r.ref)).toEqual([
      "tests.api.test_catalog#test_lists_products_with_pagination",
      "tests.api.test_catalog#test_search_by_keyword[rain jacket]",
      "tests.api.test_catalog#test_unknown_product_returns_404",
    ]);
    expect(results[2]).toMatchObject({ status: "failed", failureMessage: "AssertionError: assert 500 == 404" });
    expect(results[2]!.failureDetails).toContain('>       assert client.get("/products/does-not-exist")');
  });

  it("parses jest-junit output", () => {
    const results = parseJUnit(fixture("junit-jest.xml"));
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "passed")).toBe(true);
    expect(results[0]!.title).toContain("[TC-4]");
  });

  it("parses TestNG/Appium output with CDATA failures and system-err", () => {
    const [login, pay] = parseJUnit(fixture("junit-appium-testng.xml"));
    expect(login).toMatchObject({
      ref: "com.larkspur.mobile.android.LoginTest#signsInWithEmail",
      status: "passed",
      durationMs: 18900,
    });
    expect(pay!.status).toBe("failed");
    expect(pay!.failureDetails).toContain("AppiumDriver.<init>");
    expect(pay!.failureDetails).toContain("--- system-err ---");
  });

  it("rejects documents with a DOCTYPE (no entity expansion)", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><testsuite><testcase name="&a;"/></testsuite>`;
    expect(() => parseJUnit(xml)).toThrow(ImportFormatError);
  });

  it("rejects XML that is not a JUnit report", () => {
    expect(looksLikeJUnit("<html><body/></html>")).toBe(false);
    expect(() => parseJUnit("<html><body/></html>")).toThrow(/Not a JUnit XML report/);
  });

  it("names tests without a classname by their name only", () => {
    const [r] = parseJUnit(`<testsuite name="s"><testcase name="lonely test" time="1,5"/></testsuite>`);
    expect(r).toMatchObject({ ref: "lonely test", group: "s", durationMs: 1500 });
  });
});
