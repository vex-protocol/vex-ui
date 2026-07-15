import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReviewState, gateCommentBody } from "./codex-review-gate.mjs";

const headSha = "a".repeat(40);
const oldHeadSha = "b".repeat(40);

function pullRequest(overrides = {}) {
    return {
        comments: { nodes: [] },
        headRefOid: headSha,
        reviews: { nodes: [] },
        ...overrides,
    };
}

test("waits until Codex reviews the current head", () => {
    assert.equal(evaluateReviewState(pullRequest(), headSha).kind, "pending");
});

test("puts LGTM on the first line of the generated clean comment", () => {
    assert.equal(
        gateCommentBody("vex-protocol/vex-ui", headSha).split("\n")[0],
        "LGTM",
    );
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

test("accepts a thumbs-up on the SHA-stamped review request", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    {
                        author: { login: "github-actions[bot]" },
                        body: `@codex review\n\n<!-- codex-review-request:${headSha} -->`,
                        createdAt: "2026-07-15T12:02:00Z",
                        reactions: {
                            nodes: [
                                {
                                    content: "THUMBS_UP",
                                    createdAt: "2026-07-15T12:03:00Z",
                                    user: {
                                        login: "chatgpt-codex-connector",
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "clean");
    assert.equal(state.source, "review-request-reaction");
});

test("ignores a thumbs-up on a request for an older head", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    {
                        author: { login: "github-actions[bot]" },
                        body: `@codex review\n\n<!-- codex-review-request:${oldHeadSha} -->`,
                        createdAt: "2026-07-15T12:02:00Z",
                        reactions: {
                            nodes: [
                                {
                                    content: "THUMBS_UP",
                                    createdAt: "2026-07-15T12:03:00Z",
                                    user: {
                                        login: "chatgpt-codex-connector",
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "pending");
});

test("ignores a spoofed request marker from a pull request author", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    {
                        author: { login: "contributor" },
                        body: `@codex review\n\n<!-- codex-review-request:${headSha} -->`,
                        createdAt: "2026-07-15T12:02:00Z",
                        reactions: {
                            nodes: [
                                {
                                    content: "THUMBS_UP",
                                    createdAt: "2026-07-15T12:03:00Z",
                                    user: {
                                        login: "chatgpt-codex-connector",
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "pending");
});

test("ignores a reaction timestamped before its review request", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    {
                        author: { login: "github-actions[bot]" },
                        body: `@codex review\n\n<!-- codex-review-request:${headSha} -->`,
                        createdAt: "2026-07-15T12:03:00Z",
                        reactions: {
                            nodes: [
                                {
                                    content: "THUMBS_UP",
                                    createdAt: "2026-07-15T12:02:00Z",
                                    user: {
                                        login: "chatgpt-codex-connector",
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        }),
        headSha,
    );
    assert.equal(state.kind, "pending");
});

test("requires an LGTM comment to name the current head", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    {
                        author: { login: "chatgpt-codex-connector" },
                        body: `LGTM\n\nReviewed commit: ${oldHeadSha}`,
                        createdAt: "2026-07-15T12:03:00Z",
                        reactions: { nodes: [] },
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
                        body: `LGTM\n\nReviewed commit: ${headSha}`,
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
