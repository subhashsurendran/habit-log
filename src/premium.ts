import { getLocales } from "expo-localization";

import { listedYearPrice, PREMIUM_PRODUCT_ID } from "./premiumPrice";

export { PREMIUM_PRODUCT_ID };

export type PremiumOffer = {
  priceLabel: string;
  /** True only when the App Store returned this product. */
  ready: boolean;
  owned: boolean;
};

/** The browser cannot bill. The price is only a preview. */
export async function loadPremiumOffer(): Promise<PremiumOffer> {
  const region = getLocales()[0]?.regionCode ?? null;
  return { priceLabel: listedYearPrice(region), ready: false, owned: false };
}

export async function buyPremiumYear(): Promise<boolean> {
  return false;
}
