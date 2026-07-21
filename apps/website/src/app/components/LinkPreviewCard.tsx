import type { LinkPreviewMetadata } from "@vex-chat/store";

import { ExternalLink } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { extractLinkPreviewUrl } from "@vex-chat/store";

import { loadLinkPreviewForContent } from "../lib/linkPreview";

export function LinkPreviewCard({ content }: { content: string }) {
    const sentinelRef = useRef<HTMLSpanElement | null>(null);
    const [preview, setPreview] = useState<LinkPreviewMetadata | null>(null);
    const [imageFailed, setImageFailed] = useState(false);
    const [faviconFailed, setFaviconFailed] = useState(false);
    const [shouldLoad, setShouldLoad] = useState(false);

    useEffect(() => {
        setPreview(null);
        setImageFailed(false);
        setFaviconFailed(false);
        setShouldLoad(false);
        if (!extractLinkPreviewUrl(content)) return;
        if (typeof IntersectionObserver === "undefined") {
            setShouldLoad(true);
            return;
        }
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                setShouldLoad(true);
                observer.disconnect();
            },
            { rootMargin: "320px 0px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [content]);

    useEffect(() => {
        if (!shouldLoad) return;
        let active = true;
        void loadLinkPreviewForContent(content).then((next) => {
            if (active) setPreview(next);
        });
        return () => {
            active = false;
        };
    }, [content, shouldLoad]);

    if (!preview) {
        return <span className="link-preview-sentinel" ref={sentinelRef} />;
    }

    return (
        <a
            aria-label={`Open ${preview.title}`}
            className="link-preview"
            href={preview.url}
            rel="noreferrer noopener"
            target="_blank"
        >
            {preview.imageUrl && !imageFailed ? (
                <img
                    alt=""
                    className="link-preview__image"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    src={preview.imageUrl}
                    onError={() => setImageFailed(true)}
                />
            ) : null}
            <span className="link-preview__body">
                <span className="link-preview__source">
                    {preview.faviconUrl && !faviconFailed ? (
                        <img
                            alt=""
                            className="link-preview__favicon"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            src={preview.faviconUrl}
                            onError={() => setFaviconFailed(true)}
                        />
                    ) : null}
                    <span className="link-preview__site">
                        {preview.siteName || displayURL(preview.url)}
                    </span>
                </span>
                <span className="link-preview__title">{preview.title}</span>
                {preview.description ? (
                    <span className="link-preview__description">
                        {preview.description}
                    </span>
                ) : null}
                <span className="link-preview__url">
                    <span>{displayURL(preview.url)}</span>
                    <ExternalLink size={12} />
                </span>
            </span>
        </a>
    );
}

function displayURL(value: string): string {
    try {
        const url = new URL(value);
        const path = url.pathname === "/" ? "" : url.pathname;
        return `${url.hostname.replace(/^www\./iu, "")}${path}`;
    } catch {
        return value;
    }
}
