import assert from "node:assert/strict";
import test from "node:test";

import {
    evaluateReviewState,
    gateCommentBody,
    statusContext,
    trustedReviewRequest,
} from "./codex-review-gate.mjs";

const baseRef = "development";
const otherBaseRef = "master";
const headSha = "a".repeat(40);
const oldHeadSha = "b".repeat(40);

function reviewRequest({
    author = "github-actions[bot]",
    base = baseRef,
    createdAt = "2026-07-15T12:00:00Z",
    head = headSha,
    reactions = [],
} = {}) {
    return {
        author: { login: author },
        body: `@codex review\n\n<!-- codex-review-request:${base}:${head} -->`,
        createdAt,
        reactions: { nodes: reactions },
    };
}

function codexReview({
    findings = 0,
    head = headSha,
    submittedAt = "2026-07-15T12:01:00Z",
} = {}) {
    return {
        author: { login: "chatgpt-codex-connector[bot]" },
        comments: { totalCount: findings },
        commit: { oid: head },
        submittedAt,
    };
}

function pullRequest(overrides = {}) {
    return {
        baseRefName: baseRef,
        comments: { nodes: [reviewRequest()] },
        headRefOid: headSha,
        isDraft: false,
        reviews: { nodes: [] },
        ...overrides,
    };
}

test("waits until Codex reviews the current scope", () => {
    assert.equal(
        evaluateReviewState(pullRequest(), headSha, baseRef).kind,
        "pending",
    );
});

test("requires a trusted review request before accepting a review", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: { nodes: [] },
            reviews: { nodes: [codexReview()] },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "pending");
});

test("puts LGTM on the first line of the generated clean comment", () => {
    assert.equal(
        gateCommentBody("vex-protocol/vex-ui", headSha, baseRef).split("\n")[0],
        "LGTM",
    );
});

test("uses a different required status for each target branch", () => {
    assert.equal(statusContext(baseRef), "Codex Review / development");
    assert.equal(statusContext(otherBaseRef), "Codex Review / master");
});

test("fails when the scoped Codex review contains findings", () => {
    const state = evaluateReviewState(
        pullRequest({ reviews: { nodes: [codexReview({ findings: 2 })] } }),
        headSha,
        baseRef,
    );
    assert.deepEqual(state, {
        at: Date.parse("2026-07-15T12:01:00Z"),
        findingCount: 2,
        kind: "findings",
        source: "review",
    });
});

test("does not treat an empty review object as a scoped clean signal", () => {
    const state = evaluateReviewState(
        pullRequest({ reviews: { nodes: [codexReview()] } }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "pending");
});

test("ignores a review submitted before the trusted request", () => {
    const state = evaluateReviewState(
        pullRequest({
            reviews: {
                nodes: [codexReview({ submittedAt: "2026-07-15T11:59:00Z" })],
            },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "pending");
});

test("accepts a thumbs-up on the scoped review request", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    reviewRequest({
                        reactions: [
                            {
                                content: "THUMBS_UP",
                                createdAt: "2026-07-15T12:03:00Z",
                                user: {
                                    login: "chatgpt-codex-connector",
                                },
                            },
                        ],
                    }),
                ],
            },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "clean");
    assert.equal(state.source, "review-request-reaction");
});

test("ignores a thumbs-up on a request for an older head", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    reviewRequest({
                        head: oldHeadSha,
                        reactions: [
                            {
                                content: "THUMBS_UP",
                                createdAt: "2026-07-15T12:03:00Z",
                                user: {
                                    login: "chatgpt-codex-connector",
                                },
                            },
                        ],
                    }),
                ],
            },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "pending");
});

test("does not reuse a review request after retargeting the PR", () => {
    const state = evaluateReviewState(
        pullRequest({
            baseRefName: otherBaseRef,
            reviews: { nodes: [codexReview()] },
        }),
        headSha,
        otherBaseRef,
    );
    assert.equal(state.kind, "pending");
});

test("ignores a spoofed request marker from a contributor", () => {
    const request = reviewRequest({ author: "contributor" });
    const candidate = pullRequest({ comments: { nodes: [request] } });
    assert.equal(trustedReviewRequest(candidate, headSha, baseRef), undefined);
    assert.equal(
        evaluateReviewState(candidate, headSha, baseRef).kind,
        "pending",
    );
});

test("ignores a reaction timestamped before its review request", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    reviewRequest({
                        createdAt: "2026-07-15T12:03:00Z",
                        reactions: [
                            {
                                content: "THUMBS_UP",
                                createdAt: "2026-07-15T12:02:00Z",
                                user: {
                                    login: "chatgpt-codex-connector",
                                },
                            },
                        ],
                    }),
                ],
            },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "pending");
});

test("requires an LGTM comment to name the current head", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    reviewRequest(),
                    {
                        author: { login: "chatgpt-codex-connector" },
                        body: `LGTM\n\nReviewed commit: ${oldHeadSha}\nTarget branch: ${baseRef}`,
                        createdAt: "2026-07-15T12:03:00Z",
                        reactions: { nodes: [] },
                    },
                ],
            },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "pending");
});

test("requires an LGTM comment to name the current target branch", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    reviewRequest(),
                    {
                        author: { login: "chatgpt-codex-connector" },
                        body: `LGTM\n\nReviewed commit: ${headSha}\nTarget branch: ${otherBaseRef}`,
                        createdAt: "2026-07-15T12:03:00Z",
                        reactions: { nodes: [] },
                    },
                ],
            },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "pending");
});

test("uses the latest Codex signal for the current review scope", () => {
    const state = evaluateReviewState(
        pullRequest({
            comments: {
                nodes: [
                    reviewRequest(),
                    {
                        author: { login: "chatgpt-codex-connector" },
                        body: `LGTM\n\nReviewed commit: ${headSha}\nTarget branch: ${baseRef}`,
                        createdAt: "2026-07-15T12:03:00Z",
                        reactions: { nodes: [] },
                    },
                ],
            },
            reviews: { nodes: [codexReview({ findings: 1 })] },
        }),
        headSha,
        baseRef,
    );
    assert.equal(state.kind, "clean");
    assert.equal(state.source, "codex-comment");
});
