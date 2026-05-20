# vex.wtf website

## Local development

The site is **Vite + Preact** (`pnpm run dev`). That **only** serves the frontend; files under `api/` are plain Node HTTP handlers and are **not** started by Vite.

**Full stack (frontend + GitHub OAuth API):**

1. Copy `.env.example` to `.env` and set `SITE_ORIGIN=http://localhost:5173`, `SESSION_SECRET` (or `CLA_SESSION_SECRET`), and GitHub OAuth credentials. Register a [GitHub OAuth app](https://github.com/settings/developers) with callback URL **`http://localhost:5173/api/gh/callback`** (add your production URL too, e.g. `https://vex.wtf/api/gh/callback`).
2. Run **`pnpm website`** from the monorepo root, or **`pnpm run dev:all`** from `apps/website`. This starts Vite (port **5173**) and the local API server (default **8787**). Vite **proxies** `/api/*` to that port (`vite.config.ts` reads **`CLA_API_PORT`** from `.env`).

If you see **`EADDRINUSE`** on 8787, another dev server is still running — quit it, or set **`CLA_API_PORT`** (e.g. `8788`) in `.env` and restart (Vite picks it up for the proxy). On macOS: `lsof -i :8787` then `kill <pid>`.

**Frontend only:** `pnpm run dev` (pages work; `/api/...` fetches fail unless you also run `pnpm run dev:api`).

**API only:** `pnpm run dev:api` (for debugging the handlers on `http://127.0.0.1:8787`).

## Monorepo checks

Run these from the monorepo root before opening a PR:

```bash
pnpm -F @vex-chat/website lint
pnpm -F @vex-chat/website typecheck
pnpm -F @vex-chat/website test
pnpm -F @vex-chat/website build
```

## Deployment

For Vercel, set the project root directory to `apps/website`. The app keeps Vite output in `dist` and uses `vercel.json` for the production build command and SPA rewrites.

The API routes under `api/` are Node HTTP handlers. Vercel can run them as colocated functions; other hosts should run `pnpm -F @vex-chat/website start:api` and proxy `/api/*` to that process.

## Pages

- **`/licensing`** — Commercial licensing: contact **yuki@vex.wtf**.

## API (`api/`)

Server routes under `api/` use plain **Node.js** [`IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage) / [`ServerResponse`](https://nodejs.org/api/http.html#class-httpserverresponse) so they are not tied to Vercel. Wire them in your host’s router (Express `app.use`, nginx `proxy_pass`, Cloudflare Workers adapter, etc.).

**GitHub OAuth** — `api/gh/*` expects env: `SITE_ORIGIN` or `PUBLIC_SITE_URL` (public `https://…` site URL), `SESSION_SECRET` or `CLA_SESSION_SECRET`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, optional `CLA_SDK_VERSION`.

## Notes

- Inline SVG icon components in `src/components/Icons.tsx` were extracted from `lucide-preact` (Lucide) to reduce runtime bundle size and avoid shipping the full icon library.
