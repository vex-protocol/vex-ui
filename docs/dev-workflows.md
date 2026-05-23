# Dev Workflows

Quick reference for running development tasks in the vex-chat monorepo.

## Prerequisites

- **Node.js** 24.x (via [mise](https://mise.jdx.dev/))
- **pnpm** 11.1.3 (pinned in package.json)
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

### Development build (recommended)

```bash
pnpm -F mobile dev         # starts Metro for an installed Vex Developer dev-client
pnpm -F mobile ios         # builds/installs/launches iOS dev-client, no Metro
pnpm -F mobile android     # builds/installs/launches Android dev-client, no Metro
```

The package scripts select the Vex Developer app variant with
`VEX_MOBILE_TARGET=dev`. Build or reinstall the local native dev-client with
`ios` or `android`, then keep `dev` running for hot reload through Expo start.
When a platform native directory does not exist, Expo CLI prebuilds that
platform before the local build. After app config, native dependencies, config
plugins, or the Expo SDK change, regenerate the development native projects
with `pnpm -F mobile prebuild` and rebuild the native app. `prebuild` does not
compile or install a build by itself.

### Expo Go unsupported

Vex mobile does not support Expo Go. The app relies on native modules and
config plugins outside Expo Go's fixed runtime, so all local mobile work should
use the Vex Developer development build.

### Metro bundler (standalone)

```bash
pnpm -F mobile dev:metro   # backwards-compatible alias for pnpm -F mobile dev
```

Useful after the local development build is installed and native code has not
changed. `dev` sets `VEX_MOBILE_TARGET=dev`; no copied env file is needed for
the Vex Developer build to default to the deployed dev API.

### Full development APK

```bash
pnpm -F mobile development:android
```

This opt-in path mirrors the CI release-candidate APK more closely. Use it
when testing behavior that local `dev` intentionally disables, such as remote
push registration or always-on foreground-service behavior. It uses EAS local
build and writes `vex-development-local.apk` at the repo root.

### Legacy Android helpers

The default local flow is now `dev` for Metro plus `android`, `ios`, and
`prebuild` for native install/regeneration. Existing Android wrapper scripts
stay available during the transition for the extra work they still own:

- `pnpm -F mobile legacy:android` keeps the prior Android wrapper behind the
  old default `android` command.
- `pnpm -F mobile android:dev` is a backwards-compatible alias for the local
  Android dev-client build.
- `pnpm -F mobile development:android` runs the EAS local build for the full
  development APK.
- `pnpm -F mobile development:android:gradle-install` keeps the older direct
  Gradle full-development installer available while it is being phased out.
- `pnpm -F mobile android:multi`, `android:emulator`, `android:prod`, install
  helpers, and Android reset/log scripts remain available for specialized
  device workflows.

See [ADR-013](./architecture/adr-013-expo-native-mobile-dev-workflow.md) for
the phased migration rationale.

### Server URL configuration

The production app variant defaults to the production API at `api.vex.wtf`.
The Vex Developer variant selected by `pnpm -F mobile dev`, `dev:metro`,
`android`, and `ios` defaults to `dev.vex.wtf` from app metadata. To point app
traffic at a different server, set both `EXPO_PUBLIC_ENABLE_DEV_SERVER=1` and
`EXPO_PUBLIC_SERVER_URL` before starting Metro - **do not** edit
`src/lib/config.ts`. Release builds throw at startup if the resolved URL looks
like a dev host, so a forgotten localhost can never ship.

`EXPO_PUBLIC_SERVER_URL` does not change the native passkey relying-party
host. Native passkeys remain bound to `dev.vex.wtf` unless
`VEX_PASSKEY_RP_HOST` selects another HTTPS domain with valid iOS AASA and
Android Digital Asset Links files.

| Target                              | Command                              |
| ----------------------------------- | ------------------------------------ |
| Deployed dev API                    | `pnpm -F mobile dev`                 |
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
