const POST_AUTH_PATH_KEY = "vex-post-auth-path";

export function rememberPostAuthPath(path: string): void {
    if (isSafeAppPath(path)) sessionStorage.setItem(POST_AUTH_PATH_KEY, path);
}

export function consumePostAuthPath(): null | string {
    const path = sessionStorage.getItem(POST_AUTH_PATH_KEY);
    sessionStorage.removeItem(POST_AUTH_PATH_KEY);
    return path && isSafeAppPath(path) ? path : null;
}

function isSafeAppPath(path: string): boolean {
    if (!path.startsWith("/app/") || path.startsWith("/app/login")) {
        return false;
    }
    try {
        const parsed = new URL(path, window.location.origin);
        return (
            parsed.origin === window.location.origin &&
            parsed.pathname.startsWith("/app/") &&
            !["/app/login", "/app/recover", "/app/register"].includes(
                parsed.pathname,
            )
        );
    } catch {
        return false;
    }
}
