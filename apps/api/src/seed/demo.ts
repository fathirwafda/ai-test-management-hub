import { TestCaseInput, type ResultStatus, type TestCaseInput as CaseIn } from "@hub/shared";
import type { EvidenceStore } from "../lib/evidence-store.js";
import { attachmentKind, resolveMimeType } from "../lib/evidence-store.js";
import type { Clock } from "../repos/context.js";
import type { Store } from "../repos/store.js";
import { fakeScreenshot } from "./png.js";

/**
 * Demo data: a fictional online shop ("Larkspur Outfitters") with API, Web and mobile cases, three
 * historical runs and generated evidence. Everything here is invented for the demo.
 */

export class SeedClock implements Clock {
  constructor(private current: Date) {}
  now(): string {
    return this.current.toISOString();
  }
  set(date: Date): void {
    this.current = date;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const steps = (...pairs: [string, string][]) => pairs.map(([action, expected]) => ({ action, expected }));

type SeedCase = Omit<CaseIn, "suiteId"> & { suite: string };

const SUITES: { name: string; description: string }[] = [
  { name: "Catalog & search API", description: "Product listing, search and product detail endpoints." },
  { name: "Cart & checkout API", description: "Cart, discounts, orders and payment endpoints." },
  { name: "Web storefront", description: "Customer-facing website (desktop and mobile web)." },
  { name: "Android app", description: "Native Android shopping app." },
  { name: "iOS app", description: "Native iOS shopping app." },
];

const CASES: SeedCase[] = [
  {
    suite: "Catalog & search API",
    title: "GET /products returns a paginated catalogue",
    platform: "API",
    type: "automated",
    priority: "high",
    tags: ["catalog", "smoke"],
    automationRef: "com.larkspur.api.CatalogApiTest#listsProductsWithPagination",
    requirement: "SHOP-101: As a shopper I can browse the catalogue page by page.",
    preconditions: "Catalogue has at least 60 active products.",
    steps: steps(
      ["Send GET /products?page=1&size=24", "200 OK with 24 items and a `next` link"],
      ["Follow the `next` link", "200 OK with the next 24 items, no duplicates"],
    ),
    status: "ready",
  },
  {
    suite: "Catalog & search API",
    title: "Search returns products matching a keyword",
    platform: "API",
    type: "automated",
    priority: "high",
    tags: ["search"],
    automationRef: "com.larkspur.api.CatalogApiTest#searchesByKeyword",
    requirement: "SHOP-104: Search by keyword across name and description.",
    steps: steps([
      "Send GET /products?q=rain jacket",
      "Every result mentions 'rain jacket' in its name or description",
    ]),
    status: "ready",
  },
  {
    suite: "Catalog & search API",
    title: "Unknown product id returns 404 with an error body",
    platform: "API",
    type: "automated",
    priority: "medium",
    tags: ["catalog", "negative"],
    automationRef: "com.larkspur.api.CatalogApiTest#unknownProductReturns404",
    steps: steps(["Send GET /products/does-not-exist", '404 with {"error":"product_not_found"}']),
    status: "ready",
  },
  {
    suite: "Cart & checkout API",
    title: "Adding an item to the cart recalculates the total",
    platform: "API",
    type: "automated",
    priority: "critical",
    tags: ["cart", "smoke"],
    automationRef: "com.larkspur.api.CartApiTest#addsItemAndRecalculatesTotal",
    requirement: "SHOP-120: Cart totals include item price, quantity and tax.",
    steps: steps(
      ["POST /cart/items with sku LK-2041 and quantity 2", "201 Created"],
      ["GET /cart", "Total equals 2 x unit price + tax, rounded to 2 decimals"],
    ),
    status: "ready",
  },
  {
    suite: "Cart & checkout API",
    title: "An expired discount code is rejected",
    platform: "API",
    type: "automated",
    priority: "high",
    tags: ["discount", "negative"],
    automationRef: "com.larkspur.api.CartApiTest#rejectsExpiredDiscountCode",
    requirement: "SHOP-131: Expired codes are rejected with a clear reason.",
    steps: steps([
      "POST /cart/discount with code SPRING23 (expired)",
      "422 with reason `code_expired`; total unchanged",
    ]),
    status: "ready",
  },
  {
    suite: "Cart & checkout API",
    title: "Place an order with a saved card",
    platform: "API",
    type: "automated",
    priority: "critical",
    tags: ["checkout", "payment", "smoke"],
    automationRef: "com.larkspur.api.CheckoutApiTest#placesOrderWithSavedCard",
    preconditions: "Customer account with a saved test card; payment sandbox reachable.",
    steps: steps(
      ["POST /orders with the saved card token", "201 Created with status `paid`"],
      ["GET /orders/{id}", "Order lines and total match the cart"],
    ),
    status: "ready",
  },
  {
    suite: "Cart & checkout API",
    title: "Order-created event is published for fulfilment",
    platform: "API",
    type: "automated",
    priority: "high",
    tags: ["checkout", "events"],
    automationRef: "com.larkspur.api.CheckoutApiTest#publishesOrderCreatedEvent",
    steps: steps(["Place an order", "An `order.created` event with the order id is published within 5 s"]),
    status: "ready",
  },
  {
    suite: "Cart & checkout API",
    title: "Rate limiting returns 429 with Retry-After",
    platform: "API",
    type: "manual",
    priority: "medium",
    tags: ["resilience"],
    description: "Exploratory check of the public API rate limits.",
    steps: steps([
      "Send 120 requests in 10 s from one client",
      "Requests above the limit get 429 with a Retry-After header",
    ]),
    status: "ready",
  },
  {
    suite: "Web storefront",
    title: "Guest searches and opens a product page",
    platform: "Web",
    type: "automated",
    priority: "high",
    tags: ["search", "smoke"],
    automationRef: "e2e/catalog.spec.ts#Catalog > guest searches and opens a product",
    steps: steps(
      ["Open the home page and search for 'trail shoes'", "Results grid shows matching products"],
      ["Open the first result", "Product page shows name, price, sizes and an enabled 'Add to cart' button"],
    ),
    status: "ready",
  },
  {
    suite: "Web storefront",
    title: "Add to cart from the product page opens the mini-cart",
    platform: "Web",
    type: "automated",
    priority: "high",
    tags: ["cart"],
    automationRef: "e2e/cart.spec.ts#Cart > adds a product from the product page",
    steps: steps(["Choose a size and click 'Add to cart'", "Mini-cart opens with the item and the updated count"]),
    status: "ready",
  },
  {
    suite: "Web storefront",
    title: "Checkout with a saved card",
    platform: "Web",
    type: "automated",
    priority: "critical",
    tags: ["checkout", "payment", "smoke"],
    automationRef: "e2e/checkout.spec.ts#Checkout > pays with a saved card",
    steps: steps(
      ["Sign in, add an item and go to checkout", "Saved card is pre-selected"],
      ["Click 'Pay now'", "Confirmation page with an order number"],
    ),
    status: "ready",
  },
  {
    suite: "Web storefront",
    title: "Expired discount code shows an inline error",
    platform: "Web",
    type: "automated",
    priority: "high",
    tags: ["discount", "negative"],
    automationRef: "e2e/checkout.spec.ts#Checkout > shows an error for an expired discount code",
    steps: steps([
      "Enter SPRING23 in the discount field and apply",
      "Inline error 'This code has expired'; total unchanged",
    ]),
    status: "ready",
  },
  {
    suite: "Web storefront",
    title: "Product page layout on a narrow viewport",
    platform: "Web",
    type: "manual",
    priority: "medium",
    tags: ["responsive"],
    steps: steps([
      "Open a product page at 360 px width",
      "No horizontal scroll; gallery, price and button are visible",
    ]),
    status: "ready",
  },
  {
    suite: "Web storefront",
    title: "Checkout can be completed with the keyboard only",
    platform: "Web",
    type: "manual",
    priority: "high",
    tags: ["a11y", "checkout"],
    steps: steps([
      "Complete checkout using Tab, Shift+Tab, Enter and Space",
      "Every control is reachable, focus is visible, order is placed",
    ]),
    status: "ready",
  },
  {
    suite: "Android app",
    title: "Sign in with email and password",
    platform: "Mobile-Android",
    type: "automated",
    priority: "critical",
    tags: ["auth", "smoke"],
    automationRef: "com.larkspur.mobile.android.LoginTest#signsInWithEmail",
    steps: steps(
      ["Open the app and tap 'Sign in'", "Sign-in form is shown"],
      ["Enter valid credentials and submit", "Home screen greets the customer by first name"],
    ),
    status: "ready",
  },
  {
    suite: "Android app",
    title: "Add to bag and pay with Google Pay",
    platform: "Mobile-Android",
    type: "automated",
    priority: "critical",
    tags: ["checkout", "payment"],
    automationRef: "com.larkspur.mobile.android.CheckoutTest#paysWithGooglePay",
    steps: steps(
      ["Add a product to the bag and open checkout", "Google Pay is offered"],
      ["Pay with the test wallet", "Order confirmation screen"],
    ),
    status: "ready",
  },
  {
    suite: "Android app",
    title: "Push notification opens the order details",
    platform: "Mobile-Android",
    type: "manual",
    priority: "medium",
    tags: ["notifications"],
    steps: steps(["Trigger a 'shipped' notification for a recent order", "Tapping it opens that order's details"]),
    status: "ready",
  },
  {
    suite: "Android app",
    title: "Offline banner appears without a network connection",
    platform: "Mobile-Android",
    type: "manual",
    priority: "low",
    tags: ["resilience"],
    steps: steps(["Enable airplane mode while browsing", "An offline banner appears and cached products stay visible"]),
    status: "draft",
  },
  {
    suite: "iOS app",
    title: "Sign in with Face ID",
    platform: "Mobile-iOS",
    type: "manual",
    priority: "high",
    tags: ["auth"],
    steps: steps(["Enable Face ID in settings, sign out and reopen the app", "Face ID prompt signs the customer in"]),
    status: "ready",
  },
  {
    suite: "iOS app",
    title: "Add to bag and pay with Apple Pay",
    platform: "Mobile-iOS",
    type: "automated",
    priority: "critical",
    tags: ["checkout", "payment"],
    automationRef: "com.larkspur.mobile.ios.CheckoutTest#paysWithApplePay",
    steps: steps(
      ["Add a product and open checkout", "Apple Pay button is shown"],
      ["Pay with the sandbox wallet", "Order confirmation screen"],
    ),
    status: "ready",
  },
  {
    suite: "iOS app",
    title: "Product cards render correctly in dark mode",
    platform: "Mobile-iOS",
    type: "manual",
    priority: "low",
    tags: ["visual"],
    steps: steps([
      "Switch the device to dark mode and browse a category",
      "Text and prices stay readable; no white flashes",
    ]),
    status: "ready",
  },
  {
    suite: "Web storefront",
    title: "Legacy gift-card balance page",
    platform: "Web",
    type: "manual",
    priority: "low",
    tags: ["legacy"],
    description: "Replaced by the account wallet in release 2.3.",
    steps: steps(["Open /gift-card/balance", "Balance is shown"]),
    status: "deprecated",
  },
];

type Evidence = { name: string; data: Buffer | string };
type ResultSpec = {
  status: ResultStatus;
  durationMs?: number;
  comment?: string;
  failureMessage?: string;
  failureDetails?: string;
  evidence?: Evidence[];
  /** Playwright attachment paths recorded as metadata only. */
  external?: { name: string; contentType: string; path: string }[];
};

const P = (durationMs: number): ResultSpec => ({ status: "passed", durationMs });

const expiredCodeResponse = JSON.stringify(
  {
    request: { method: "POST", url: "/cart/discount", body: { code: "SPRING23" } },
    response: { status: 200, body: { applied: true, discount: 15.0, total: 84.99 } },
  },
  null,
  2,
);

const har = JSON.stringify(
  {
    log: {
      version: "1.2",
      creator: { name: "demo", version: "1.0" },
      entries: [
        {
          startedDateTime: "2026-11-10T09:14:02.120Z",
          time: 30012,
          request: { method: "POST", url: "https://payments-sandbox.example.test/v1/charges", headers: [] },
          response: {
            status: 503,
            statusText: "Service Unavailable",
            headers: [],
            content: { size: 19, mimeType: "text/plain", text: "upstream overloaded" },
          },
        },
      ],
    },
  },
  null,
  2,
);

const appiumLog = [
  "[Appium] Welcome to Appium",
  "[HTTP] --> POST /session",
  "[AndroidUiautomator2Driver] Starting emulator 'Pixel_8_API_35'",
  "[ADB] Device 'emulator-5554' is offline, waiting...",
  "[ADB] Device 'emulator-5554' did not come online within 120000 ms",
  "[HTTP] <-- POST /session 500",
  "SessionNotCreatedException: Could not start a new session. Response code 500. Message: An unknown server-side error occurred while processing the command. Original error: emulator device offline",
].join("\n");

const cartLog = [
  "09:02:11.204 INFO  CartApiTest - POST /cart/discount code=SPRING23",
  '09:02:11.388 INFO  CartApiTest - <- 200 OK {"applied":true,"discount":15.0}',
  "09:02:11.389 ERROR CartApiTest - expected status <422> but was <200>",
  "java.lang.AssertionError: 1 expectation failed.",
  "Expected status code <422> but was <200>.",
  "\tat com.larkspur.api.CartApiTest.rejectsExpiredDiscountCode(CartApiTest.java:88)",
].join("\n");

/** Results per run, keyed by case index (0-based position in CASES). Missing entries stay untested. */
function runPlans(): {
  name: string;
  environment: string;
  build: string;
  daysAgo: number;
  close: boolean;
  results: Record<number, ResultSpec>;
}[] {
  return [
    {
      name: "Sprint 41 regression",
      environment: "staging",
      build: "2.3.0",
      daysAgo: 20,
      close: true,
      results: {
        0: P(812),
        1: P(640),
        2: P(210),
        3: P(930),
        4: P(455),
        5: P(2210),
        6: P(5120),
        7: { status: "passed", durationMs: 600000, comment: "Limits hold at 100 req/10 s." },
        8: P(8120),
        9: P(5230),
        10: P(14800),
        11: P(6410),
        12: P(240000),
        13: { status: "passed", durationMs: 420000 },
        14: P(18200),
        15: {
          status: "failed",
          durationMs: 61000,
          failureMessage: "Order confirmation not shown after Google Pay sheet closed",
          comment: "Fixed in 2.4.0 (bag state lost after wallet return).",
        },
        16: P(180000),
        18: P(150000),
        19: P(41000),
        20: { status: "skipped", comment: "No dark-mode device available this sprint." },
      },
    },
    {
      name: "Sprint 42 regression",
      environment: "staging",
      build: "2.4.0",
      daysAgo: 9,
      close: true,
      results: {
        0: P(790),
        1: P(702),
        2: P(198),
        3: P(901),
        4: P(470),
        5: P(2390),
        6: P(4870),
        7: P(540000),
        8: P(7900),
        9: {
          status: "failed",
          durationMs: 30100,
          failureMessage:
            "Error: expect(locator).toBeVisible() failed: locator('[data-test=mini-cart]') not found within 5000ms",
          failureDetails:
            "Error: expect(locator).toBeVisible() failed\n  Locator: locator('[data-test=mini-cart]')\n  Expected: visible\n  Timeout: 5000ms\n    at e2e/cart.spec.ts:27:41",
          evidence: [{ name: "mini-cart-missing.png", data: fakeScreenshot({ error: false }) }],
        },
        10: P(15100),
        11: P(6020),
        12: P(210000),
        13: P(380000),
        14: P(17600),
        15: P(58800),
        16: P(170000),
        17: P(90000),
        18: P(140000),
        19: P(39800),
        20: P(200000),
      },
    },
    {
      name: "Release 2.5.0 candidate",
      environment: "staging",
      build: "2.5.0-rc.1",
      daysAgo: 1,
      close: false,
      results: {
        0: P(805),
        1: P(688),
        2: P(205),
        3: P(944),
        4: {
          status: "failed",
          durationMs: 512,
          failureMessage: "java.lang.AssertionError: Expected status code <422> but was <200>.",
          failureDetails: cartLog,
          evidence: [
            { name: "discount-response.json", data: expiredCodeResponse },
            { name: "cart-api-test.log", data: cartLog },
          ],
        },
        5: {
          status: "blocked",
          durationMs: 30050,
          comment: "Payment sandbox returned 503 for every charge; retry once it is back.",
          failureMessage: "Payment sandbox unavailable: 503 Service Unavailable",
          evidence: [{ name: "payments-sandbox.har", data: har }],
        },
        6: P(5010),
        8: P(8030),
        9: P(5480),
        10: P(14950),
        11: {
          status: "failed",
          durationMs: 30042,
          failureMessage:
            "TimeoutError: locator.click: Timeout 30000ms exceeded. waiting for getByRole('button', { name: 'Apply code' })",
          failureDetails:
            "TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Apply code' })\n    at e2e/checkout.spec.ts:58:52",
          evidence: [{ name: "apply-code-timeout.png", data: fakeScreenshot({ error: true }) }],
          external: [
            {
              name: "trace",
              contentType: "application/zip",
              path: "test-results/checkout-shows-an-error-chromium/trace.zip",
            },
          ],
        },
        14: P(18900),
        15: {
          status: "failed",
          durationMs: 121300,
          failureMessage:
            "SessionNotCreatedException: Could not start a new session. Original error: emulator device offline",
          failureDetails: appiumLog,
          evidence: [{ name: "appium-server.log", data: appiumLog }],
        },
        16: { status: "retest", comment: "Notification arrived but opened the home screen once out of three tries." },
        19: P(40500),
      },
    },
  ];
}

export async function seedDemo(
  store: Store,
  evidence: EvidenceStore,
  clock: SeedClock,
  base = new Date(),
): Promise<{ projectId: number }> {
  const at = (daysAgo: number, hour = 9) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };
  clock.set(at(30));
  const project = store.projects.create({
    name: "Larkspur Outfitters",
    description: "Demo project: a fictional outdoor-clothing shop with a public API, a website and Android/iOS apps.",
  });
  const suiteIds = new Map<string, number>();
  for (const s of SUITES) suiteIds.set(s.name, store.suites.create(project.id, s).id);

  const caseIds: number[] = [];
  for (const c of CASES) {
    clock.advance(60_000);
    const { suite, ...rest } = c;
    caseIds.push(
      store.cases.create(project.id, TestCaseInput.parse({ ...rest, suiteId: suiteIds.get(suite) ?? null })).id,
    );
  }

  const testers = ["Dana K.", "Sam R.", "ci"];
  for (const plan of runPlans()) {
    clock.set(at(plan.daysAgo, 8));
    const active = caseIds.filter((_, i) => CASES[i]!.status !== "deprecated");
    const run = store.runs.create(
      project.id,
      { name: plan.name, environment: plan.environment, build: plan.build },
      active,
    );
    const detail = store.runs.detail(run.id);
    let minute = 0;
    for (const [index, spec] of Object.entries(plan.results)) {
      const caseId = caseIds[Number(index)]!;
      const item = detail.items.find((i) => i.caseId === caseId)!;
      clock.set(new Date(at(plan.daysAgo, 9).getTime() + (minute += 7) * 60_000));
      const automated = CASES[Number(index)]!.type === "automated";
      store.runs.patchItem(item.id, {
        status: spec.status,
        durationMs: spec.durationMs ?? null,
        comment: spec.comment ?? "",
        executedBy: automated ? "ci" : testers[Number(index) % 2]!,
      });
      if (spec.failureMessage || spec.failureDetails) {
        store.ctx.db
          .prepare("UPDATE run_items SET failure_message = ?, failure_details = ? WHERE id = ?")
          .run(spec.failureMessage ?? "", spec.failureDetails ?? "", item.id);
      }
      for (const e of spec.evidence ?? []) {
        const data = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : e.data;
        const key = await evidence.save(data, e.name);
        const mimeType = resolveMimeType(e.name, undefined);
        store.attachments.create({
          runItemId: item.id,
          fileName: e.name,
          mimeType,
          sizeBytes: data.length,
          kind: attachmentKind(e.name, mimeType),
          storageKey: key,
          externalPath: null,
        });
      }
      for (const x of spec.external ?? []) {
        store.attachments.create({
          runItemId: item.id,
          fileName: `${x.name} (${x.path.split("/").pop()})`,
          mimeType: x.contentType,
          sizeBytes: 0,
          kind: "file",
          storageKey: null,
          externalPath: x.path,
        });
      }
    }
    if (plan.close) {
      clock.set(at(plan.daysAgo - 1, 17));
      store.runs.setStatus(run.id, "closed");
    }
  }
  return { projectId: project.id };
}
