import { applyEmoji, normalizeExternalUrl } from "@vex-chat/store";

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";

import { openExternalUrl } from "../externalLinks.js";

// Re-export shared utilities so existing imports keep working
export {
    chunkMessages,
    formatFileSize,
    formatTime,
    isImageType,
    parseFileExtra,
} from "@vex-chat/store";
export type { FileAttachment, MessageChunk } from "@vex-chat/store";

// ── Platform-specific: HTML rendering (requires DOM + marked + DOMPurify) ───

marked.use({
    breaks: true,
    renderer: {
        code({ lang, text }) {
            return renderCodeBlock(text, lang);
        },
        text({ text }) {
            return escapeHtml(applyEmoji(text));
        },
    },
});

/**
 * Open only validated web links from sanitized message content.
 */
export function handleLinkClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target.closest("a") : null;
    if (!target) return;
    e.preventDefault();
    openExternalUrl(target.getAttribute("href"));
}

export function renderCodeBlock(
    code: string,
    language: string | undefined,
): string {
    const normalizedLanguage = normalizeCodeLanguage(language);
    const highlighted =
        normalizedLanguage && hljs.getLanguage(normalizedLanguage)
            ? hljs.highlight(code, {
                  ignoreIllegals: true,
                  language: normalizedLanguage,
              }).value
            : hljs.highlightAuto(code).value;
    const languageClass = normalizedLanguage
        ? ` language-${escapeHtml(normalizedLanguage)}`
        : "";
    return `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>`;
}

/**
 * Renders message content: emoji → markdown → sanitized HTML.
 * Safe to use with {@html} in Svelte.
 */
export function renderContent(content: string): string {
    const raw = marked.parse(content) as string;
    const sanitized = DOMPurify.sanitize(raw, {
        ALLOW_DATA_ATTR: false,
        ALLOWED_ATTR: ["href", "rel", "src", "alt", "class"],
        ALLOWED_TAGS: [
            "p",
            "br",
            "strong",
            "em",
            "code",
            "pre",
            "blockquote",
            "ul",
            "ol",
            "li",
            "a",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "hr",
            "del",
            "img",
            "span",
        ],
        RETURN_DOM: true,
    });
    if (!(sanitized instanceof Element)) return "";
    for (const link of sanitized.querySelectorAll("a")) {
        const url = normalizeExternalUrl(link.getAttribute("href"));
        if (url) {
            link.setAttribute("href", url);
            link.setAttribute("rel", "noreferrer noopener");
        } else {
            link.removeAttribute("href");
        }
    }
    return sanitized.innerHTML;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '"':
                return "&quot;";
            case "&":
                return "&amp;";
            case "'":
                return "&#39;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            default:
                return char;
        }
    });
}

function normalizeCodeLanguage(value: string | undefined): string | undefined {
    const language = value?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!language || language.length > 64 || !/^[\w#+.-]+$/.test(language)) {
        return undefined;
    }
    return language;
}
