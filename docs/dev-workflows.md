# Dev Workflows

Quick reference for running development tasks in the vex-chat monorepo.

## Prerequisites

- **Node.js** 24.x (via [mise](https://mise.jdx.dev/))
- **pnpm** 10.30.3 (pinned in package.json)
- **Rust** 1.77.2+ (desktop only)

```bash
pnpm install
```

---

## Server (spire)

The server lives in its own repo: [`vex-chat/spire`](https://github.com/vex-chat/spire). See that repo for server setup, environment variables, and development workflow.

---

## Desktop (Tauri + Svelte)

Cross-platform desktop client — macOS, Windows, Linux.

### Prerequisites

- Rust 1.77.2+
- macOS: Xcode command line tools
- Windows: Visual Studio Build Tools
- Linux: GTK 3/4 dev libraries

### Run dev

```bash
pnpm --filter @vex-chat/desktop dev
```

Starts Vite on `localhost:5180` and opens a Tauri window. Frontend hot-reloads.

### Build

```bash
pnpm --filter @vex-chat/desktop build
```

Creates platform-specific binaries (dmg, msi, AppImage).

### Type check

```bash
pnpm --filter @vex-chat/desktop check
```

---

## Mobile (Expo + React Native)

Native iOS and Android client via Expo Prebuild (CNG). `ios/` and `android/` directories are gitignored — generated from `app.json` + config plugins.

### Prerequisites

- macOS for iOS: Xcode 16+
- Android: Android SDK, emulator or device
- `npx expo prebuild` generates native projects from config

### First-time setup

```bash
cd apps/mobile
npx expo prebuild          # generates ios/ and android/
```

### Development build (recommended)

```bash
npx expo run:ios           # builds native + launches on iOS simulator
npx expo run:android       # builds native + launches on Android emulator
```

After the first build (~2-5 min), subsequent launches are fast. JS changes hot-reload instantly.

### Expo Go (quick JS-only testing)

```bash
npx expo start             # opens in Expo Go on device/simulator
```

Expo Go has a fixed set of native modules. Packages with custom native code (`expo-sqlite`, `expo-notifications`, etc.) will crash in Expo Go — use a development build instead. See `docs/explanation/platform-strategy.md` for the full Expo Go vs dev build comparison.

### Metro bundler (standalone)

```bash
npx expo start --dev-client   # connects to an existing development build
```

Useful if the app needs to reconnect to the bundler after the native binary is already running.

### Server URL configuration

The mobile app always defaults to the production API at `api.vex.wtf`. To point at a different server, set `EXPO_PUBLIC_SERVER_URL` before starting Metro — **do not** edit `src/lib/config.ts`. Release builds throw at startup if the resolved URL looks like a dev host, so a forgotten localhost can never ship.

| Target                              | Command                              |
| ----------------------------------- | ------------------------------------ |
| Production (default)                | `pnpm -F mobile dev`                 |
| iOS simulator → local spire         | `pnpm -F mobile dev:local`           |
| Android emulator → local spire      | `pnpm -F mobile dev:android-reverse` |
| Physical device, same Wi-Fi         | `pnpm -F mobile dev:lan`             |
| Physical device, off-LAN (Tailscale) | Put the 100.x IP in `apps/mobile/.env.local`, then `pnpm -F mobile dev` |

Personal overrides live in `apps/mobile/.env.local` (gitignored). `apps/mobile/.env.example` documents the available variables.

`dev:android-reverse` runs `adb reverse tcp:16777 tcp:16777` first, which must be re-run after every emulator restart — bake it into your flow or re-run this script.

---

## Component Library (Mitosis → React + Svelte)

Framework-agnostic components compiled to both React and Svelte.

### Build components

```bash
pnpm --filter @vex-chat/ui build           # both targets
pnpm --filter @vex-chat/ui build:react     # React only
pnpm --filter @vex-chat/ui build:svelte    # Svelte only
```

Output goes to `output/react/` and `output/svelte/`.

### Run Storybook

```bash
pnpm --filter @vex-chat/ui storybook
```

Starts three servers:
- **React stories**: `http://localhost:6001`
- **Svelte stories**: `http://localhost:6002`
- **Composition host**: `http://localhost:6000` (both side-by-side)

### Development loop

1. Write components in `src/*.tsx` (Mitosis syntax)
2. Run `pnpm build` to compile
3. View in Storybook
4. Import in apps: `@vex-chat/ui/react/Button` or `@vex-chat/ui/svelte/Button`

---

## Shared Packages

These have no build step -- apps import TypeScript source directly.

**Monorepo packages:**

| Package | Purpose | Used by |
|---|---|---|
| `packages/store` | Nanostores reactive state | desktop, mobile |

**Sibling repos (linked via pnpm workspace):**

| Repo | npm name | Purpose | Used by |
|---|---|---|---|
| `../types-js` | `@vex-chat/types` | Shared TypeScript interfaces | all apps + packages |
| `../crypto-js` | `@vex-chat/crypto` | Ed25519, X3DH, NaCl encryption | libvex (also consumed by spire via npm) |
| `../libvex-js` | `@vex-chat/libvex` | Client SDK (WebSocket, auth, messaging) | store, desktop, mobile |

---

## Run Everything

```bash
pnpm dev
```

Runs all client apps in parallel (desktop, mobile). The server (spire) runs separately from its own repo.

---

## Common Tasks

### New contributor onboarding

```bash
git clone https://github.com/vex-chat/vex-chat.git
cd vex-chat
pnpm install
pnpm dev                                     # start client apps
```

### Desktop dev loop

```bash
pnpm --filter @vex-chat/desktop dev
```

Edit `apps/desktop/src/*.svelte` → Vite HMR updates the Tauri window.

---

## Dependency Graph

```
apps/desktop ─── packages/store ─── @vex-chat/libvex ─── @vex-chat/crypto
                      │                                        │
                      └──────── @vex-chat/types ◄──────────────┘
apps/mobile ──── packages/store
packages/ui ──── (standalone, compiles to React + Svelte)

Sibling repos (published to npm, consumed via verdaccio or registry):
../types-js   (@vex-chat/types)
../crypto-js  (@vex-chat/crypto)
../libvex-js  (@vex-chat/libvex)

External (NOT in pnpm workspace):
spire (own repo) ── @vex-chat/crypto (via npm)
```
