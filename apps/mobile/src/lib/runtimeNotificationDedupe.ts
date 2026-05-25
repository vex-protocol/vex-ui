// Cap on the in-memory mailID dedup sets. Long-lived FGS sessions
// would otherwise grow these without bound — every message ever
// notified, retained for the life of the process. 1k is a generous
// ceiling; it covers many days of normal usage, and the only correctness
// risk of evicting older IDs is "we might re-notify on a duplicate
// from very far in the past," which the historical-cutoff timestamp
// already filters out separately.
export const NOTIFIED_MAILID_DEDUP_CAP = 1000;

/**
 * Bounded `Set<string>` with FIFO eviction: when adding past the cap,
 * the oldest inserted entry is dropped.
 *
 * `Set` already iterates in insertion order in V8/Hermes, so the
 * "oldest" entry is `inner.values().next().value`. That's the only
 * non-obvious thing about this implementation — the rest is a thin
 * surface compatible with the parts of `Set<string>` we use here
 * (`has`, `add`, `clear`).
 */
export class BoundedStringSet {
    private readonly cap: number;
    private readonly inner = new Set<string>();

    constructor(cap: number) {
        this.cap = cap;
    }

    add(value: string): void {
        if (this.inner.has(value)) {
            return;
        }
        this.inner.add(value);
        while (this.inner.size > this.cap) {
            const oldest = this.inner.values().next().value;
            if (oldest === undefined) {
                break;
            }
            this.inner.delete(oldest);
        }
    }

    clear(): void {
        this.inner.clear();
    }

    has(value: string): boolean {
        return this.inner.has(value);
    }
}

export const runtimeNotifiedMailIDs = new BoundedStringSet(
    NOTIFIED_MAILID_DEDUP_CAP,
);
