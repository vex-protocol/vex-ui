import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReviewState } from "./codex-review-gate.mjs";

const headSha = "a".repeat(40);
const committedDate = "2026-07-15T12:00:00Z";

function pullRequest(overrides = {}) {
    return {
        comments: { nodes: [] },
        commits: { nodes: [{ commit: { committedDate } }] },
        headRefOid: headSha,
        reactions: { nodes: [] },
        reviews: { nodes: [] },
        ...overrides,
    };
}

test("waits until Codex reviews the current head", () => {
    assert.equal(evaluateReviewState(pullRequest(), headSha).kind, "pending");
});

test("fails when the current Codex review contains findings", () => {
    const state = evaluateReviewState(
        pullRequest({
            reviews: {
                nodes: [
                    {
                        author: { login: "chatgpt-codex-connector" },
                        comments: { totalCount: 2 },
                        commit: { oid: headSha },
                        submittedAt: "2026-07-15T12:01:00Z",
                    },
                ],
            },
        }),
        headSha,
    );
    assert.deepEqual(state, {
        at: Date.parse("2026-07-15T12:01:00Z"),
        findingCount: 2,
        kind: "findings",
        source: "review",
    });
});

test("passes a current Codex review without findings", () => {
    const state = evaluateReviewState(
        pullRequest({
            reviews: {
                nodes: [
                    {
                        author: { login: "chatgpt-codex-connector[bot]" },
                        comments: { totalCount: 0 },
                        commit: { oid: headSha },
                        submittedAt: "2026-07-15T12:01:00Z",
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "clean");
    assert.equal(state.source, "review");
});

test("accepts Codex's documented thumbs-up signal", () => {
    const state = evaluateReviewState(
        pullRequest({
            reactions: {
                nodes: [
                    {
                        content: "THUMBS_UP",
                        createdAt: "2026-07-15T12:02:00Z",
                        user: { login: "chatgpt-codex-connector" },
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "clean");
    assert.equal(state.source, "pull-request-reaction");
});

test("ignores a no-findings reaction from an older commit", () => {
    const state = evaluateReviewState(
        pullRequest({
            reactions: {
                nodes: [
                    {
                        content: "THUMBS_UP",
                        createdAt: "2026-07-15T11:59:00Z",
                        user: { login: "chatgpt-codex-connector" },
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "pending");
});

test("uses the latest Codex signal for the current head", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    {
                        author: { login: "chatgpt-codex-connector" },
                        body: "LGTM\n\nNo actionable findings.",
                        createdAt: "2026-07-15T12:03:00Z",
                        reactions: { nodes: [] },
                    },
                ],
            },
            reviews: {
                nodes: [
                    {
                        author: { login: "chatgpt-codex-connector" },
                        comments: { totalCount: 1 },
                        commit: { oid: headSha },
                        submittedAt: "2026-07-15T12:01:00Z",
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "clean");
    assert.equal(state.source, "codex-comment");
});
