import { applyEmoji } from "@vex-chat/store";

import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";

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
 * Handles clicks inside the message box. Intercepts data-external links
 * and opens them in the native browser via tauri-plugin-opener.
 */
export function handleLinkClick(e: MouseEvent): void {
    const target = (e.target as Element).closest("[data-external]");
    if (!target) return;
    e.preventDefault();
    const url = target.getAttribute("data-external");
    if (url) openUrl(url).catch(console.error);
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
 * External links get a `data-external` attribute for native-browser interception.
 * Safe to use with {@html} in Svelte.
 */
export function renderContent(content: string): string {
    const raw = marked.parse(content) as string;
    // Annotate <a> tags with data-external so handleLinkClick can intercept them
    const annotated = raw.replace(
        /<a\s+href="([^"]+)"/g,
        '<a href="$1" data-external="$1"',
    );
    return DOMPurify.sanitize(annotated, {
        ALLOWED_ATTR: ["href", "data-external", "rel", "src", "alt", "class"],
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
    });
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
