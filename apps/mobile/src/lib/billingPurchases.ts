import type {
    BillingEnvironment,
    BillingPlatform,
    BillingProduct,
} from "@vex-chat/store";
import type {
    MutationFinishTransactionArgs,
    ProductSubscription,
    Purchase,
    PurchaseError,
} from "react-native-iap";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import {
    $billingOperation,
    $billingProducts,
    $user,
    vexService,
} from "@vex-chat/store";

import { useStore } from "@nanostores/react";
import { useIAP } from "react-native-iap";

export interface BillingPurchaseController {
    connected: boolean;
    error: null | string;
    nativeSubscriptions: ProductSubscription[];
    pendingProductID: null | string;
    products: BillingProduct[];
    refresh: () => Promise<void>;
    restore: () => Promise<void>;
    startPurchase: (product: BillingProduct) => Promise<void>;
    storeProductFor: (
        product: BillingProduct,
    ) => null | ProductSubscription | undefined;
}

type FinishTransaction = (args: MutationFinishTransactionArgs) => Promise<void>;

export function useBillingPurchases(): BillingPurchaseController {
    const products = useStore($billingProducts);
    const user = useStore($user);
    const operation = useStore($billingOperation);
    const [storeError, setStoreError] = useState<null | string>(null);
    const [pendingProductID, setPendingProductID] = useState<null | string>(
        null,
    );
    const finishTransactionRef = useRef<FinishTransaction | null>(null);
    const processingPurchaseKeysRef = useRef(new Set<string>());

    const platformProducts = useMemo(
        () =>
            products.filter(
                (product) => product.platform === currentBillingPlatform(),
            ),
        [products],
    );
    const productIDs = useMemo(
        () => platformProducts.map((product) => product.storeProductID),
        [platformProducts],
    );

    const processPurchase = useCallback(
        async (purchase: Purchase): Promise<void> => {
            const key = purchaseKey(purchase);
            if (processingPurchaseKeysRef.current.has(key)) {
                return;
            }
            processingPurchaseKeysRef.current.add(key);
            setStoreError(null);
            setPendingProductID(purchase.productId);
            try {
                const result =
                    Platform.OS === "ios"
                        ? await vexService.submitAppleStoreTransaction(
                              appleTransactionRequestFromPurchase(purchase),
                          )
                        : await vexService.submitGooglePlayPurchase(
                              googlePurchaseRequestFromPurchase(
                                  purchase,
                                  platformProducts,
                              ),
                          );
                if (!result.ok) {
                    throw new Error(
                        result.error ?? "Subscription verification failed.",
                    );
                }
                const finish = finishTransactionRef.current;
                if (finish) {
                    await finish({ isConsumable: false, purchase });
                }
                await vexService.refreshBillingAccount();
            } catch (err: unknown) {
                const message = errorMessage(err);
                setStoreError(message);
                throw err;
            } finally {
                processingPurchaseKeysRef.current.delete(key);
                setPendingProductID((current) =>
                    current === purchase.productId ? null : current,
                );
            }
        },
        [platformProducts],
    );

    const {
        availablePurchases,
        connected,
        fetchProducts,
        finishTransaction,
        getAvailablePurchases,
        reconnect,
        requestPurchase,
        restorePurchases,
        subscriptions,
    } = useIAP({
        onError: (error) => {
            setStoreError(error.message);
        },
        onPurchaseError: (error) => {
            setStoreError(formatPurchaseError(error));
            setPendingProductID(null);
        },
        onPurchaseSuccess: (purchase) => {
            void processPurchase(purchase).catch((err: unknown) => {
                console.warn("[vex-billing] purchase verification failed", err);
            });
        },
    });

    useEffect(() => {
        finishTransactionRef.current = finishTransaction;
    }, [finishTransaction]);

    useEffect(() => {
        if (!connected || productIDs.length === 0) {
            return;
        }
        void fetchProducts({ skus: productIDs, type: "subs" }).catch(
            (err: unknown) => {
                setStoreError(errorMessage(err));
            },
        );
    }, [connected, fetchProducts, productIDs]);

    useEffect(() => {
        for (const purchase of availablePurchases) {
            void processPurchase(purchase).catch((err: unknown) => {
                console.warn("[vex-billing] restore verification failed", err);
            });
        }
    }, [availablePurchases, processPurchase]);

    const storeProductFor = useCallback(
        (product: BillingProduct) =>
            subscriptions.find(
                (subscription) => subscription.id === product.storeProductID,
            ),
        [subscriptions],
    );

    const refresh = useCallback(async (): Promise<void> => {
        setStoreError(null);
        await vexService.refreshBillingProducts();
        await vexService.refreshBillingAccount();
        if (!connected) {
            await reconnect();
        }
        if (productIDs.length > 0) {
            await fetchProducts({ skus: productIDs, type: "subs" });
        }
    }, [connected, fetchProducts, productIDs, reconnect]);

    const restore = useCallback(async (): Promise<void> => {
        setStoreError(null);
        await restorePurchases({
            includeSuspendedAndroid: true,
            onlyIncludeActiveItemsIOS: true,
        });
        await getAvailablePurchases({
            includeSuspendedAndroid: true,
            onlyIncludeActiveItemsIOS: true,
        });
    }, [getAvailablePurchases, restorePurchases]);

    const startPurchase = useCallback(
        async (product: BillingProduct): Promise<void> => {
            if (product.platform !== currentBillingPlatform()) {
                throw new Error(
                    "This product is not available on this device.",
                );
            }
            const nativeProduct = storeProductFor(product);
            if (!nativeProduct) {
                throw new Error("This subscription is not available yet.");
            }
            setStoreError(null);
            setPendingProductID(product.productID);
            try {
                if (Platform.OS === "ios") {
                    const appleRequest = {
                        ...(user?.userID
                            ? { appAccountToken: user.userID }
                            : {}),
                        sku: product.storeProductID,
                    };
                    await requestPurchase({
                        request: {
                            apple: appleRequest,
                        },
                        type: "subs",
                    });
                    return;
                }

                const offerToken = firstGoogleOfferToken(nativeProduct);
                if (!offerToken) {
                    throw new Error(
                        "This Google Play subscription has no purchase offer.",
                    );
                }
                const googleRequest = {
                    ...(user?.userID
                        ? { obfuscatedAccountId: user.userID }
                        : {}),
                    skus: [product.storeProductID],
                    subscriptionOffers: [
                        {
                            offerToken,
                            sku: product.storeProductID,
                        },
                    ],
                };
                await requestPurchase({
                    request: {
                        google: googleRequest,
                    },
                    type: "subs",
                });
            } catch (err: unknown) {
                setPendingProductID(null);
                const message = errorMessage(err);
                setStoreError(message);
                throw err;
            }
        },
        [requestPurchase, storeProductFor, user?.userID],
    );

    return {
        connected,
        error: storeError ?? operation.error,
        nativeSubscriptions: subscriptions,
        pendingProductID,
        products: platformProducts,
        refresh,
        restore,
        startPurchase,
        storeProductFor,
    };
}

function appleTransactionRequestFromPurchase(purchase: Purchase): {
    environment?: BillingEnvironment;
    signedTransactionInfo?: string;
    transactionID?: string;
} {
    const environment = normalizeAppleEnvironment(
        "environmentIOS" in purchase ? purchase.environmentIOS : undefined,
    );
    const signedTransactionInfo = stringOrUndefined(purchase.purchaseToken);
    const transactionID = stringOrUndefined(
        "transactionId" in purchase ? purchase.transactionId : purchase.id,
    );
    return {
        ...(environment ? { environment } : {}),
        ...(signedTransactionInfo ? { signedTransactionInfo } : {}),
        ...(transactionID ? { transactionID } : {}),
    };
}

function currentBillingPlatform(): BillingPlatform {
    return Platform.OS === "ios" ? "apple_app_store" : "google_play";
}

function environmentForProduct(
    products: BillingProduct[],
    storeProductID: string,
): BillingEnvironment | undefined {
    return products.find((product) => product.storeProductID === storeProductID)
        ?.environment;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function firstGoogleOfferToken(
    product: ProductSubscription,
): string | undefined {
    if (product.platform !== "android") {
        return undefined;
    }
    return product.subscriptionOffers[0]?.offerTokenAndroid ?? undefined;
}

function formatPurchaseError(error: PurchaseError): string {
    return error.debugMessage ?? error.message;
}

function googlePurchaseRequestFromPurchase(
    purchase: Purchase,
    products: BillingProduct[],
): {
    environment?: BillingEnvironment;
    packageName?: string;
    productID: string;
    purchaseToken: string;
} {
    const environment = environmentForProduct(products, purchase.productId);
    const packageName = stringOrUndefined(
        "packageNameAndroid" in purchase
            ? purchase.packageNameAndroid
            : undefined,
    );
    return {
        ...(environment ? { environment } : {}),
        ...(packageName ? { packageName } : {}),
        productID: purchase.productId,
        purchaseToken: requiredPurchaseToken(purchase),
    };
}

function normalizeAppleEnvironment(
    value: null | string | undefined,
): BillingEnvironment | undefined {
    const normalized = value?.toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (normalized.includes("sandbox")) {
        return "sandbox";
    }
    if (normalized.includes("production")) {
        return "production";
    }
    return undefined;
}

function purchaseKey(purchase: Purchase): string {
    return [
        purchase.store,
        purchase.productId,
        purchase.transactionDate,
        "transactionId" in purchase ? purchase.transactionId : null,
        purchase.purchaseToken,
        purchase.id,
    ]
        .filter((part): part is number | string => part != null)
        .join(":");
}

function requiredPurchaseToken(purchase: Purchase): string {
    const token = stringOrUndefined(purchase.purchaseToken);
    if (!token) {
        throw new Error("Store purchase token is missing.");
    }
    return token;
}

function stringOrUndefined(
    value: null | string | undefined,
): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
