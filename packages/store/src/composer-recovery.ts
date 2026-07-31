export interface ComposerRecoveryDraft<TAttachment, TMetadata = undefined> {
    readonly attachment: TAttachment | undefined;
    readonly id: number;
    readonly metadata: TMetadata;
    readonly value: string;
}

export interface ComposerRecoveryDraftInput<
    TAttachment,
    TMetadata = undefined,
> {
    attachment?: TAttachment;
    metadata: TMetadata;
    value: string;
}

export class ComposerRecoveryQueue<TAttachment, TMetadata = undefined> {
    readonly #drafts = new Map<
        string,
        ComposerRecoveryDraft<TAttachment, TMetadata>[]
    >();
    readonly #maxEntries: number;
    #nextID = 1;

    constructor(maxEntries = 20) {
        if (!Number.isInteger(maxEntries) || maxEntries < 1) {
            throw new RangeError("maxEntries must be a positive integer");
        }
        this.#maxEntries = maxEntries;
    }

    add(
        contextKey: string,
        input: ComposerRecoveryDraftInput<TAttachment, TMetadata>,
    ): ComposerRecoveryDraft<TAttachment, TMetadata> | null {
        if (
            !contextKey ||
            (input.value.length === 0 && input.attachment === undefined)
        ) {
            return null;
        }

        const draft = {
            attachment: input.attachment,
            id: this.#nextID++,
            metadata: input.metadata,
            value: input.value,
        };
        const contextDrafts = this.#drafts.get(contextKey) ?? [];
        this.#drafts.set(contextKey, [...contextDrafts, draft]);
        this.#trim();
        return draft;
    }

    get(
        contextKey: string,
    ): readonly ComposerRecoveryDraft<TAttachment, TMetadata>[] {
        return [...(this.#drafts.get(contextKey) ?? [])];
    }

    remove(contextKey: string, id: number): boolean {
        const contextDrafts = this.#drafts.get(contextKey);
        if (!contextDrafts) return false;

        const next = contextDrafts.filter((draft) => draft.id !== id);
        if (next.length === contextDrafts.length) return false;
        if (next.length === 0) {
            this.#drafts.delete(contextKey);
        } else {
            this.#drafts.set(contextKey, next);
        }
        return true;
    }

    #entryCount(): number {
        let count = 0;
        for (const drafts of this.#drafts.values()) {
            count += drafts.length;
        }
        return count;
    }

    #trim(): void {
        while (this.#entryCount() > this.#maxEntries) {
            let oldest:
                | undefined
                | {
                      contextKey: string;
                      draft: ComposerRecoveryDraft<TAttachment, TMetadata>;
                  };
            for (const [contextKey, drafts] of this.#drafts) {
                const candidate = drafts[0];
                if (!candidate) continue;
                if (!oldest || candidate.id < oldest.draft.id) {
                    oldest = { contextKey, draft: candidate };
                }
            }
            if (!oldest) return;
            this.remove(oldest.contextKey, oldest.draft.id);
        }
    }
}
