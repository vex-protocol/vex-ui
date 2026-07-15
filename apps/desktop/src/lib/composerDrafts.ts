const drafts = new Map<string, string>();
const MAX_DRAFTS = 100;

export function clearComposerDraft(key: string): void {
    drafts.delete(key);
}

export function readComposerDraft(key: string): string {
    return drafts.get(key) ?? "";
}

export function writeComposerDraft(key: string, value: string): void {
    if (value.length === 0) {
        drafts.delete(key);
        return;
    }
    drafts.delete(key);
    drafts.set(key, value);
    while (drafts.size > MAX_DRAFTS) {
        const oldest = drafts.keys().next().value;
        if (typeof oldest !== "string") break;
        drafts.delete(oldest);
    }
}
