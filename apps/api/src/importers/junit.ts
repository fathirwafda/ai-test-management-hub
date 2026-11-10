import { XMLParser } from "fast-xml-parser";
import { ImportFormatError, stripAnsi, truncate, type ImportedResult } from "./types.js";

/**
 * Parses JUnit XML as written by Maven Surefire/Failsafe (JUnit 4/5, TestNG, REST Assured, Selenium, Appium),
 * pytest `--junitxml`, jest-junit, Playwright's junit reporter and most CI tools.
 *
 * Supported shapes: a `<testsuites>` root, a single `<testsuite>` root and nested suites. A testcase with
 * `<failure>` or `<error>` is failed, with `<skipped>` is skipped, otherwise passed. Surefire's
 * `<flakyFailure>`/`<flakyError>` (failed, then passed on rerun) are recorded as passed with a note.
 */

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  // Entity expansion is not needed for test reports; leaving it off avoids entity-expansion attacks.
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) =>
    [
      "testsuite",
      "testcase",
      "failure",
      "error",
      "skipped",
      "flakyFailure",
      "flakyError",
      "rerunFailure",
      "property",
    ].includes(name),
});

const MAX_DETAILS = 20_000;

function asArray(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) =>
    typeof v === "object" && v !== null ? (v as Node) : { "#text": String(v) },
  );
}

function text(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(text).join("\n");
  if (typeof node === "object") return text((node as Node)["#text"]);
  return "";
}

const attr = (node: Node, name: string) => {
  const v = node[`@${name}`];
  return typeof v === "string" ? decodeEntities(v) : "";
};

/** Decodes the five XML entities and numeric references (processEntities is off on purpose). */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function collectCases(suite: Node, out: { testcase: Node; suiteName: string }[]): void {
  const suiteName = attr(suite, "name");
  for (const tc of asArray(suite.testcase)) out.push({ testcase: tc, suiteName });
  for (const child of asArray(suite.testsuite)) collectCases(child, out);
}

function seconds(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}

export function looksLikeJUnit(content: string): boolean {
  return /<(testsuites|testsuite)[\s>]/.test(content.slice(0, 5000));
}

export function parseJUnit(content: string): ImportedResult[] {
  if (/<!DOCTYPE/i.test(content)) throw new ImportFormatError("JUnit XML with a DOCTYPE is not accepted");
  if (!looksLikeJUnit(content))
    throw new ImportFormatError("Not a JUnit XML report: no <testsuites> or <testsuite> element");

  let doc: Node;
  try {
    doc = parser.parse(content, true) as Node;
  } catch (err) {
    throw new ImportFormatError(`Invalid XML: ${(err as Error).message}`);
  }

  const roots = doc.testsuites ? asArray(doc.testsuites) : [{ testsuite: doc.testsuite }];
  const found: { testcase: Node; suiteName: string }[] = [];
  for (const root of roots) collectCases(root, found);

  return found.map(({ testcase, suiteName }) => {
    const name = attr(testcase, "name").trim() || "(unnamed test)";
    const classname = attr(testcase, "classname").trim();
    const failures = [...asArray(testcase.failure), ...asArray(testcase.error)];
    const flaky = [...asArray(testcase.flakyFailure), ...asArray(testcase.flakyError)];
    const skipped = asArray(testcase.skipped);

    const status = failures.length > 0 ? "failed" : skipped.length > 0 ? "skipped" : "passed";
    const first = failures[0];
    const failureMessage = first
      ? attr(first, "message") || decodeEntities(text(first)).trim().split("\n")[0] || attr(first, "type")
      : "";
    const details = [
      ...failures.map((f) => [attr(f, "type"), decodeEntities(text(f)).trim()].filter(Boolean).join("\n")),
      decodeEntities(text(testcase["system-out"])).trim() &&
        `--- system-out ---\n${decodeEntities(text(testcase["system-out"])).trim()}`,
      decodeEntities(text(testcase["system-err"])).trim() &&
        `--- system-err ---\n${decodeEntities(text(testcase["system-err"])).trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let note = "";
    if (status === "skipped") note = attr(skipped[0]!, "message");
    else if (status === "passed" && flaky.length > 0) {
      note =
        `Passed on rerun after ${flaky.length} flaky failure(s): ${attr(flaky[0]!, "message") || attr(flaky[0]!, "type")}`.trim();
    }

    return {
      ref: classname ? `${classname}#${name}` : name,
      title: name,
      group: classname || suiteName,
      status,
      durationMs: seconds(attr(testcase, "time")),
      failureMessage: truncate(stripAnsi(failureMessage), 2000),
      failureDetails: truncate(stripAnsi(details), MAX_DETAILS),
      note,
      tags: [],
      attachments: [],
    } satisfies ImportedResult;
  });
}
