import { countStatuses, passRate, progress, type RunDetail, type RunItem } from "@hub/shared";
import { describe, expect, it } from "vitest";
import { csvCell, escapeHtml, runToCsv, runToHtml, runToMarkdown } from "../../src/reports/run-report.js";

const item = (over: Partial<RunItem>): RunItem => ({
  id: 1,
  runId: 1,
  caseId: 1,
  caseKey: "TC-1",
  caseTitle: "Checkout | pays",
  platform: "Web",
  type: "automated",
  priority: "high",
  automationRef: null,
  status: "passed",
  comment: "",
  durationMs: 1200,
  executedBy: "ci",
  executedAt: "2026-11-10T09:00:00.000Z",
  failureMessage: "",
  failureDetails: "",
  triage: null,
  attachments: [],
  ...over,
});

const items = [
  item({}),
  item({
    id: 2,
    caseKey: "TC-2",
    caseTitle: '<script>alert("x")</script>',
    status: "failed",
    failureMessage: "expected 422\nbut was 200",
    comment: '=HYPERLINK("http://evil")',
    triage: { category: "product_bug", summary: "Discount not validated", acceptedBy: "Dana" },
  }),
];
const counts = countStatuses(items.map((i) => i.status));
const run: RunDetail = {
  id: 7,
  projectId: 1,
  name: "Release 2.5.0",
  environment: "staging",
  build: "2.5.0",
  status: "open",
  source: "manual",
  notes: "",
  createdAt: "2026-11-10T08:00:00.000Z",
  closedAt: null,
  counts,
  passRate: passRate(counts),
  progress: progress(counts),
  items,
};

describe("CSV export", () => {
  it("quotes per RFC 4180 and neutralises spreadsheet formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(null)).toBe("");
    const csv = runToCsv(run);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^key,title,platform/);
    expect(lines).toHaveLength(3);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"expected 422\nbut was 200"');
  });
});

describe("Markdown export", () => {
  it("summarises the run, lists what needs attention and escapes table pipes", () => {
    const md = runToMarkdown(run, "2026-11-10T10:00:00Z");
    expect(md).toContain("# Test run report: Release 2.5.0");
    expect(md).toContain("**Pass rate:** 50.0%");
    expect(md).toContain("## Needs attention");
    expect(md).toContain("Triage (AI-suggested, accepted by a person): **Product bug**");
    expect(md).toContain("| TC-1 | Checkout \\| pays |");
  });
});

describe("HTML export", () => {
  it("escapes all user content", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const html = runToHtml(run, "now");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<title>Test run report: Release 2.5.0</title>");
  });
});
