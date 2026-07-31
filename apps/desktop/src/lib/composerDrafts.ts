import type { ComposerRecoveryDraft } from "@vex-chat/store";

import { ComposerRecoveryQueue } from "@vex-chat/store";

const drafts = new Map<string, string>();
const MAX_DRAFTS = 100;
const failedSends = new ComposerRecoveryQueue<File>();

export type FailedComposerSend = ComposerRecoveryDraft<File>;

export function clearComposerDraft(key: string): void {
    drafts.delete(key);
}

export function dismissFailedComposerSend(key: string, id: number): boolean {
    return failedSends.remove(key, id);
}

export function readComposerDraft(key: string): string {
    return drafts.get(key) ?? "";
}

export function readFailedComposerSends(
    key: string,
): readonly FailedComposerSend[] {
    return failedSends.get(key);
}

export function rememberFailedComposerSend(
    key: string,
    value: string,
    attachment: File | undefined,
): FailedComposerSend | null {
    return failedSends.add(key, {
        attachment,
        metadata: undefined,
        value,
    });
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
