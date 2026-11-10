import { expect, type Page } from "@playwright/test";

/** The demo project created by the seed script. */
export const PROJECT = "/p/1";

/** A 1x1 PNG, used as uploaded evidence. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;

export async function setTesterName(page: Page, name: string) {
  await page.getByLabel("Your name (for results)").fill(name);
  // the field is saved after a short debounce
  await expect(async () => {
    expect(await page.evaluate(() => localStorage.getItem("hub.testerName"))).toBe(name);
  }).toPass();
}
