/** India sees rupees. Every other storefront sees US dollars until Apple's own price loads. */
export function listedYearPrice(regionOrStorefront: string | null | undefined): string {
  const code = (regionOrStorefront ?? "").trim().toUpperCase();
  if (code === "IN" || code === "IND") return "₹499 a year";
  return "$4.99 a year";
}

export const PREMIUM_PRODUCT_ID = "mydtc.premium.yearly";
