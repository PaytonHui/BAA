/**
 * Buy Me a Coffee — tip jar for people who enjoy BAA.
 * Page: https://buymeacoffee.com/huipayton9
 */
export const BUY_ME_A_COFFEE_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_BUY_ME_A_COFFEE_URL?: string } }).env
      ?.VITE_BUY_ME_A_COFFEE_URL) ||
  "https://www.buymeacoffee.com/huipayton9";

/** QR image served from public/ (scan to open the same page) */
export const BUY_ME_A_COFFEE_QR = "/donate/buy-me-a-coffee-qr.png";

/** Opens the Buy Me a Coffee page in the default browser. */
export async function openBuyMeACoffee(): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(BUY_ME_A_COFFEE_URL);
}
