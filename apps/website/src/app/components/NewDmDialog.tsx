import type { User } from "@vex-chat/libvex";

import { ArrowRight, LoaderCircle, Search, X } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { $user, vexService } from "@vex-chat/store";

import { dmPath, navigate } from "../lib/router";
import { useStoreValue } from "../lib/useStoreValue";
import { Avatar } from "./Avatar";

interface NewDmDialogProps {
    onClose: () => void;
    open: boolean;
}

export function NewDmDialog({ onClose, open }: NewDmDialogProps) {
    const currentUser = useStoreValue($user);
    const [query, setQuery] = useState("");
    const [result, setResult] = useState<User | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setResult(null);
        setError("");
        window.requestAnimationFrame(() => inputRef.current?.focus());
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose, open]);

    if (!open) return null;

    async function search(event: SubmitEvent) {
        event.preventDefault();
        const normalized = query.trim().toLowerCase();
        setResult(null);
        setError("");
        if (!normalized) return;
        setLoading(true);
        try {
            const found = await vexService.lookupUser(normalized);
            if (!found) {
                setError("No account found with that username.");
                return;
            }
            if (found.userID === currentUser?.userID) {
                setError("Choose someone other than your own account.");
                return;
            }
            setResult(found);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div
            className="dialog-backdrop"
            role="presentation"
            onMouseDown={(event) => {
                if (event.currentTarget === event.target) onClose();
            }}
        >
            <section
                aria-labelledby="new-dm-title"
                aria-modal="true"
                className="web-dialog"
                role="dialog"
            >
                <header className="web-dialog__header">
                    <div>
                        <h2 id="new-dm-title">New message</h2>
                        <p>Find someone by username.</p>
                    </div>
                    <button
                        aria-label="Close"
                        title="Close"
                        type="button"
                        onClick={onClose}
                    >
                        <X size={17} />
                    </button>
                </header>
                <form className="web-dialog__search" onSubmit={search}>
                    <Search size={17} />
                    <input
                        autoCapitalize="none"
                        autoComplete="off"
                        placeholder="username"
                        ref={inputRef}
                        spellcheck={false}
                        value={query}
                        onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                    <button
                        aria-label="Search"
                        disabled={!query.trim() || loading}
                        title="Search"
                    >
                        {loading ? (
                            <LoaderCircle className="spin" size={17} />
                        ) : (
                            <ArrowRight size={17} />
                        )}
                    </button>
                </form>
                {error ? (
                    <p className="web-dialog__error" role="alert">
                        {error}
                    </p>
                ) : null}
                {result ? (
                    <button
                        className="user-search-result"
                        type="button"
                        onClick={() => {
                            onClose();
                            navigate(dmPath(result.userID));
                        }}
                    >
                        <Avatar
                            name={result.username}
                            size={36}
                            userID={result.userID}
                        />
                        <span>
                            <strong>{result.username}</strong>
                            <small>Start a direct message</small>
                        </span>
                        <ArrowRight size={17} />
                    </button>
                ) : null}
            </section>
        </div>
    );
}
