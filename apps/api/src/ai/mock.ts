import {
  formatPercent,
  type CaseType,
  type GeneratedCase,
  type Platform,
  type Priority,
  type RunSummarySuggestion,
  type TriageCategory,
  type TriageSuggestion,
} from "@hub/shared";
import type {
  CompletionRequest,
  CompletionResult,
  GenerateCasesInput,
  LlmProvider,
  RunSummaryInput,
  TriageInput,
} from "./types.js";

/**
 * A deterministic, rule-based stand-in for an LLM. Same input, same output, no network and no key.
 *
 * It lets the whole app, the tests and CI run offline, and it shows the shape of each AI feature. It is not
 * clever: it splits acceptance criteria into cases, matches failure text against keyword lists and adds up
 * run numbers. The real model is expected to do better on the same contract (see the README).
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock-rules-v1";

  complete(request: CompletionRequest): Promise<CompletionResult> {
    const { task } = request;
    let body: unknown;
    switch (task.kind) {
      case "generate-cases":
        body = { cases: mockGenerateCases(task.input) };
        break;
      case "triage":
        body = mockTriage(task.input);
        break;
      case "run-summary":
        body = mockRunSummary(task.input);
        break;
    }
    return Promise.resolve({ text: JSON.stringify(body), model: this.model });
  }
}

// ---------- test case generation ----------

const PLATFORM_HINTS: [Platform, RegExp][] = [
  ["Mobile-Android", /\bandroid\b/i],
  ["Mobile-iOS", /\b(ios|iphone|ipad)\b/i],
  ["API", /\b(api|endpoint|request|response|status code|json|rest|graphql|webhook)\b/i],
  ["Web", /\b(web|browser|page|button|click|form|website|desktop)\b/i],
];

const DOMAIN_TAGS: [string, RegExp][] = [
  ["checkout", /\b(checkout|order)\b/i],
  ["payment", /\b(pay|payment|card|refund)\b/i],
  ["discount", /\b(discount|promo|coupon|voucher)\b/i],
  ["cart", /\b(cart|basket|bag)\b/i],
  ["auth", /\b(log ?in|sign ?in|password|otp|session|log ?out)\b/i],
  ["search", /\b(search|filter|sort)\b/i],
  ["a11y", /\b(accessib|screen reader|keyboard|contrast)\w*/i],
  ["notifications", /\b(email|push|notification|sms)\b/i],
];

const MANUAL_HINT =
  /\b(look|looks|visual|layout|design|copy|wording|usability|exploratory|feel|animation|screen reader)\b/i;
const NEGATIVE_HINT =
  /\b(invalid|error|expired|declined|reject|rejected|fail|fails|wrong|not allowed|cannot|can't|blocked|denied)\b/i;
const HIGH_HINT = /\b(pay|payment|checkout|order|log ?in|password|security|must|refund|price|total)\b/i;
const LOW_HINT = /\b(tooltip|copy|wording|cosmetic|nice to have|optional)\b/i;

/** Splits a story into acceptance criteria: bullets, numbered items, or Given/When/Then scenarios. */
export function extractCriteria(story: string): string[] {
  const lines = story
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const criteria: string[] = [];
  let scenario: string[] = [];
  const flush = () => {
    if (scenario.length) criteria.push(scenario.join(" "));
    scenario = [];
  };
  for (const line of lines) {
    if (/^scenario( outline)?:/i.test(line)) {
      flush();
      continue;
    }
    if (/^(given|when|then|and|but)\b/i.test(line)) {
      scenario.push(line);
      continue;
    }
    flush();
    const bullet = /^(?:[-*•]|\d+[.)]|ac\s*\d+[:.)-]?)\s*(.+)$/i.exec(line);
    if (bullet?.[1]) criteria.push(bullet[1]);
  }
  flush();
  if (criteria.length > 0) return criteria;
  // No list: fall back to sentences that state a behaviour.
  return story
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /\b(should|must|can|cannot|will|shows?|displays?|returns?)\b/i.test(s) && !/^as an?\b/i.test(s));
}

function actorOf(story: string): string {
  const m = /\bas an? ([^,.\n]+?)(?:,|\s+i\s+want)/i.exec(story);
  return m?.[1]?.trim().toLowerCase() ?? "user";
}

/** "I want to apply a discount code at checkout" -> "apply a discount code at checkout". */
function goalOf(story: string): string | null {
  const m = /\bi want (?:to )?([^,.\n]+?)(?:,|\s+so that|\.|\n|$)/i.exec(story);
  return m?.[1]?.trim() ?? null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/, "")
    .trim();
const CONDITIONAL = /^(?:when|if|after|once)\s+(.+?),\s*(?:then\s+)?(.+)$/i;

function stepsFor(criterion: string, actor: string, goal: string | null): GeneratedCase["steps"] {
  // Gherkin keywords are capitalised; a lowercase "and" inside a sentence is not a step.
  const gwt = [
    ...criterion.matchAll(/\b(Given|When|Then|And|But)\b\s+(.+?)(?=\s+\b(?:Given|When|Then|And|But)\b\s+|$)/g),
  ];
  if (gwt.length >= 2 && gwt.some((m) => m[1] === "Then")) {
    return gwt.map((m) => {
      const word = m[1]!;
      return { keyword: (word === "But" ? "And" : word) as "Given" | "When" | "Then" | "And", text: clean(m[2]!) };
    });
  }
  const given = { keyword: "Given" as const, text: `the ${actor} is on the relevant screen with valid test data` };
  const conditional = CONDITIONAL.exec(criterion);
  if (conditional) {
    return [
      given,
      ...(goal ? [{ keyword: "And" as const, text: `the ${actor} tries to ${goal}` }] : []),
      { keyword: "When", text: clean(conditional[1]!) },
      { keyword: "Then", text: clean(conditional[2]!) },
    ];
  }
  return [
    given,
    { keyword: "When", text: goal ? `the ${actor} tries to ${goal}` : `the ${actor} performs the described action` },
    { keyword: "Then", text: clean(criterion).replace(/^./, (c) => c.toLowerCase()) },
  ];
}

function titleFor(criterion: string): string {
  const conditional = CONDITIONAL.exec(criterion);
  const base = conditional
    ? `${clean(conditional[2]!)} when ${clean(conditional[1]!)}`
    : clean(criterion.replace(/^(given|when|then)\s+/i, ""));
  const title = base.length > 110 ? `${base.slice(0, 107).trimEnd()}...` : base;
  return capitalise(title.length >= 5 ? title : `Verify ${title}`);
}

export function mockGenerateCases(input: GenerateCasesInput): GeneratedCase[] {
  const actor = actorOf(input.story);
  const goal = goalOf(input.story);
  const criteria = extractCriteria(input.story);
  const storyPlatform = PLATFORM_HINTS.find(([, re]) => re.test(input.story))?.[0];

  const cases = criteria.map((criterion, index): GeneratedCase => {
    const platform =
      input.platformHint ?? PLATFORM_HINTS.find(([, re]) => re.test(criterion))?.[0] ?? storyPlatform ?? "Web";
    const negative = NEGATIVE_HINT.test(criterion);
    const manual = MANUAL_HINT.test(criterion);
    const priority: Priority = LOW_HINT.test(criterion)
      ? "low"
      : manual
        ? "medium"
        : HIGH_HINT.test(criterion)
          ? negative
            ? "high"
            : "critical"
          : negative
            ? "medium"
            : "high";
    const suggestedType: CaseType = manual ? "manual" : "automated";
    const own = DOMAIN_TAGS.filter(([, re]) => re.test(criterion)).map(([t]) => t);
    const tags = (own.length ? own : DOMAIN_TAGS.filter(([, re]) => re.test(input.story)).map(([t]) => t)).slice(0, 4);
    if (negative) tags.push("negative");
    return {
      title: titleFor(criterion),
      platform,
      priority,
      suggestedType,
      rationale: `Covers acceptance criterion ${index + 1}. ${manual ? "Needs human judgement (visual or usability), so manual." : "Deterministic and repeatable, so a good automation candidate."}`,
      steps: stepsFor(criterion, actor, goal),
      tags: [...new Set(tags)].slice(0, 6),
    };
  });

  if (cases.length === 0) {
    cases.push({
      title: "Happy path for the described story",
      platform: input.platformHint ?? storyPlatform ?? "Web",
      priority: "high",
      suggestedType: "manual",
      rationale:
        "The story has no explicit acceptance criteria; start with an exploratory happy-path check and refine the criteria.",
      steps: [
        { keyword: "Given", text: `the ${actor} has access to the feature` },
        { keyword: "When", text: `the ${actor} completes the main flow described in the story` },
        { keyword: "Then", text: "the outcome matches the story's goal" },
      ],
      tags: [],
    });
  }
  return cases.slice(0, input.maxCases);
}

// ---------- failure triage ----------

const TRIAGE_RULES: { category: TriageCategory; label: string; pattern: RegExp; weight: number }[] = [
  {
    category: "environment",
    label: "connection refused or reset",
    pattern: /ECONNREFUSED|ECONNRESET|connection (refused|reset)/i,
    weight: 3,
  },
  {
    category: "environment",
    label: "DNS lookup failure",
    pattern: /ENOTFOUND|getaddrinfo|EAI_AGAIN|UnknownHost/i,
    weight: 3,
  },
  {
    category: "environment",
    label: "gateway or availability error (502/503/504)",
    pattern: /\b(502|503|504)\b|bad gateway|service unavailable|gateway time-?out/i,
    weight: 3,
  },
  {
    category: "environment",
    label: "TLS/certificate problem",
    pattern: /certificate|SSL|TLS handshake|CERT_/i,
    weight: 2,
  },
  {
    category: "environment",
    label: "network or socket timeout",
    pattern: /ETIMEDOUT|socket hang up|read timed out|SocketTimeout|net::ERR_/i,
    weight: 2,
  },
  {
    category: "environment",
    label: "device or driver session problem",
    pattern:
      /SessionNotCreated|session not created|could not start a new session|device (is )?offline|did not come online|emulator/i,
    weight: 4,
  },
  {
    category: "test_issue",
    label: "locator did not resolve",
    pattern: /locator|selector|NoSuchElement|element not found|no element|strict mode violation/i,
    weight: 3,
  },
  {
    category: "test_issue",
    label: "stale or detached element",
    pattern: /StaleElementReference|element is not attached|detached from the DOM/i,
    weight: 3,
  },
  {
    category: "test_issue",
    label: "test timeout while waiting",
    pattern: /Test timeout of \d+ms exceeded|waiting for|TimeoutError|toBeVisible/i,
    weight: 2,
  },
  {
    category: "test_issue",
    label: "test code error",
    pattern: /is not a function|Cannot read propert(y|ies) of undefined.*(spec|test)|fixture .* not found/i,
    weight: 2,
  },
  {
    category: "data",
    label: "missing or unknown test data",
    pattern:
      /user not found|no such (user|account|product)|unknown (sku|product|user)|404 Not Found.*(user|account|product)/i,
    weight: 3,
  },
  {
    category: "data",
    label: "duplicate or conflicting data",
    pattern: /already exists|duplicate key|unique constraint|409 Conflict/i,
    weight: 3,
  },
  {
    category: "data",
    label: "seed or fixture data problem",
    pattern: /test data|seed|fixture data|out of stock|insufficient (funds|stock)|expired (card|token|account)/i,
    weight: 2,
  },
  {
    category: "product_bug",
    label: "assertion on application output failed",
    pattern: /expected .+ (to (be|equal)|but (was|got|received))|AssertionError|Expected: .+Received:/is,
    weight: 2,
  },
  { category: "product_bug", label: "server error (500)", pattern: /\b500\b|Internal Server Error/i, weight: 3 },
  {
    category: "product_bug",
    label: "unhandled exception in the application",
    pattern: /NullPointerException|TypeError|undefined is not|stack trace.*(service|controller)/i,
    weight: 2,
  },
  {
    category: "product_bug",
    label: "wrong value shown or returned",
    pattern: /incorrect|wrong (total|price|value)|mismatch/i,
    weight: 2,
  },
];

const NEXT_STEPS: Record<TriageCategory, string[]> = {
  product_bug: [
    "Reproduce the steps manually on the same build and environment.",
    "If it reproduces, raise a bug with the failure message, evidence and build number.",
  ],
  test_issue: [
    "Re-run the test locally with tracing or screenshots to see the page state at the failure.",
    "Check whether the UI changed and update the locator or wait condition.",
  ],
  environment: [
    "Check the health of the environment and dependent services at the time of the run.",
    "Re-run once the environment is healthy; mark the result as blocked if it stays unavailable.",
  ],
  data: [
    "Verify the test account or record exists and is in the expected state.",
    "Reset or re-seed the test data, then re-run.",
  ],
};

export function mockTriage(input: TriageInput): TriageSuggestion {
  const evidence = [input.failureMessage, input.details, input.comment].join("\n");
  const scores: Record<TriageCategory, number> = { product_bug: 0, test_issue: 0, environment: 0, data: 0 };
  const signals: string[] = [];
  for (const rule of TRIAGE_RULES) {
    const match = rule.pattern.exec(evidence);
    if (match) {
      scores[rule.category] += rule.weight;
      signals.push(`${rule.label}: "${match[0].replace(/\s+/g, " ").slice(0, 80)}"`);
    }
  }
  const history = input.previousStatuses.filter((s) => s === "passed" || s === "failed");
  const flips = history.slice(1).filter((s, i) => s !== history[i]).length;
  if (flips >= 2) {
    scores.test_issue += 2;
    signals.push(`result flipped ${flips} times in earlier runs (possible flakiness)`);
  }

  const ranked = (Object.entries(scores) as [TriageCategory, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const noSignal = top![1] === 0;
  const category: TriageCategory = noSignal ? "product_bug" : top![0];
  const margin = top![1] - second![1];
  const confidence = noSignal || margin === 0 ? "low" : margin >= 3 ? "high" : "medium";

  const label = {
    product_bug: "a product bug",
    test_issue: "a test issue",
    environment: "an environment problem",
    data: "a test data problem",
  }[category];
  const summary = noSignal
    ? `No recognisable failure signal for ${input.caseKey}; treat as a possible product bug until reproduced.`
    : `${input.caseKey} most likely failed because of ${label}.`;
  const reasoning = noSignal
    ? "The failure message and logs do not contain any of the known patterns (network errors, locator failures, data conflicts, assertion output). Without more evidence the safest assumption is that the behaviour is wrong; reproduce it before raising a bug."
    : `The evidence matched ${signals.length} known pattern(s). The strongest group points to ${label}${margin === 0 ? ", but another category scored the same, so the evidence is ambiguous" : ""}. Confirm by looking at the attached evidence before acting.`;

  return {
    category,
    confidence,
    summary,
    reasoning,
    signals: signals.slice(0, 8),
    nextSteps: NEXT_STEPS[category],
  };
}

// ---------- run summary ----------

export function mockRunSummary(input: RunSummaryInput): RunSummarySuggestion {
  const c = input.counts;
  const executed = c.total - c.untested;
  const importantFailures = input.items.filter(
    (i) => (i.status === "failed" || i.status === "blocked") && (i.priority === "critical" || i.priority === "high"),
  );
  const otherFailures = input.items.filter(
    (i) => (i.status === "failed" || i.status === "blocked") && !importantFailures.includes(i),
  );
  const untestedImportant = input.items.filter(
    (i) => i.status === "untested" && (i.priority === "critical" || i.priority === "high"),
  );

  const verdict: RunSummarySuggestion["verdict"] =
    importantFailures.length > 0 || (c.total > 0 && executed / c.total < 0.5)
      ? "not_ready"
      : otherFailures.length > 0 || untestedImportant.length > 0 || c.retest > 0
        ? "ready_with_risks"
        : "ready";

  const list = (items: typeof input.items) =>
    items
      .slice(0, 4)
      .map((i) => i.key)
      .join(", ") + (items.length > 4 ? ` and ${items.length - 4} more` : "");

  const highlights = [
    `${executed} of ${c.total} cases executed; pass rate ${formatPercent(input.passRate, 1)}.`,
    `${c.passed} passed, ${c.failed} failed, ${c.blocked} blocked, ${c.skipped} skipped, ${c.retest} to retest.`,
  ];
  const platforms = [...new Set(input.items.filter((i) => i.status === "passed").map((i) => i.platform))];
  if (platforms.length) highlights.push(`Passing coverage on: ${platforms.join(", ")}.`);

  const risks: string[] = [];
  if (importantFailures.length) risks.push(`High-priority failures or blocks: ${list(importantFailures)}.`);
  if (otherFailures.length) risks.push(`Lower-priority failures or blocks: ${list(otherFailures)}.`);
  if (untestedImportant.length) risks.push(`High-priority cases not yet executed: ${list(untestedImportant)}.`);
  if (c.retest) risks.push(`${c.retest} case(s) marked for retest.`);
  const env = input.items.filter((i) => i.triageCategory === "environment");
  if (env.length)
    risks.push(`${env.length} failure(s) triaged as environment problems; results may understate quality.`);

  const headline = {
    ready: `${input.name}: no blocking issues found in ${executed} executed cases.`,
    ready_with_risks: `${input.name}: no high-priority failures, but ${risks.length} risk(s) to accept or resolve.`,
    not_ready: `${input.name}: not ready, ${importantFailures.length ? `${importantFailures.length} high-priority failure(s)` : "less than half the run executed"}.`,
  }[verdict];

  const recommendation = {
    ready: "Proceed with the release, keeping the usual post-release monitoring.",
    ready_with_risks:
      "Release only if the owners accept the listed risks; otherwise fix or re-run the affected cases first.",
    not_ready: "Hold the release. Triage and fix the high-priority failures, finish the untested cases and re-run.",
  }[verdict];

  return { verdict, headline, highlights, risks: risks.slice(0, 8), recommendation };
}
