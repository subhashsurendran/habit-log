import {
  fetchProducts,
  finishTransaction,
  getActiveSubscriptions,
  getStorefront,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from "expo-iap";
import { getLocales } from "expo-localization";

import { listedYearPrice, PREMIUM_PRODUCT_ID } from "./premiumPrice";

export { PREMIUM_PRODUCT_ID };

export type PremiumOffer = {
  priceLabel: string;
  ready: boolean;
  owned: boolean;
};

function regionCode(): string | null {
  return getLocales()[0]?.regionCode ?? null;
}

function priceFromProducts(products: unknown): string | null {
  if (!Array.isArray(products)) return null;
  for (const item of products) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: string; productId?: string; displayPrice?: string };
    const id = row.id ?? row.productId;
    if (id === PREMIUM_PRODUCT_ID && row.displayPrice) return `${row.displayPrice} a year`;
  }
  return null;
}

/** Asks Apple for the year product. A missing product does not unlock anything. */
export async function loadPremiumOffer(): Promise<PremiumOffer> {
  const listed = listedYearPrice(regionCode());
  try {
    await initConnection();
    let storefront: string | null = null;
    try {
      storefront = await getStorefront();
    } catch {
      storefront = regionCode();
    }
    const products = await fetchProducts({ skus: [PREMIUM_PRODUCT_ID], type: "subs" });
    const storePrice = priceFromProducts(products);
    let owned = false;
    try {
      const active = await getActiveSubscriptions([PREMIUM_PRODUCT_ID]);
      owned = active.some((item) => item.productId === PREMIUM_PRODUCT_ID);
    } catch {
      owned = false;
    }
    return {
      priceLabel: storePrice ?? listedYearPrice(storefront),
      ready: storePrice != null,
      owned,
    };
  } catch {
    return { priceLabel: listed, ready: false, owned: false };
  }
}

/** Opens the Apple sheet. Returns true only after the store confirms this product. */
export function buyPremiumYear(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      updated.remove();
      failed.remove();
      resolve(value);
    };
    const updated = purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== PREMIUM_PRODUCT_ID) return;
      void finishTransaction({ purchase, isConsumable: false })
        .then(() => finish(true))
        .catch(() => finish(false));
    });
    const failed = purchaseErrorListener(() => finish(false));
    void requestPurchase({
      type: "subs",
      request: { apple: { sku: PREMIUM_PRODUCT_ID } },
    }).catch(() => finish(false));
  });
}
