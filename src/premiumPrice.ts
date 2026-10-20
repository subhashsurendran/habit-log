/** India sees rupees. Every other storefront sees US dollars until Apple's own price loads. */
export function listedYearPrice(regionOrStorefront: string | null | undefined): string {
  const code = (regionOrStorefront ?? "").trim().toUpperCase();
  if (code === "IN" || code === "IND") return "₹499 a year";
  return "$4.99 a year";
}

export const PREMIUM_PRODUCT_ID = "mydtc.premium.yearly";

/** Stays available with or without a subscription. */
export const FREE_WITH = [
  "This month's grid",
  "Reminders on this phone",
  "A backup kept on this phone",
] as const;

/** Added only after Apple confirms the year. Not switched on in this build. */
export const YEAR_ADDS = ["Older months", "The later insights"] as const;
