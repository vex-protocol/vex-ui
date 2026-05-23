# Platform Strategy

Vex is a cross-platform chat application targeting desktop and mobile.

---

## Stack

| Platform | Shell | UI Framework | Notes |
|---|---|---|---|
| Desktop | **Tauri 2.0** | **Svelte** | Replaces the original Electron+React `vex-desktop` ([ADR-001](../architecture/adr-001-monorepo-consolidation.md)) |
| Mobile | **Expo (Prebuild)** | React Native 0.83 / Expo SDK 55 | Expo Prebuild (CNG) for config plugins and EAS builds; upgrade to SDK 56 + RN 0.85 when stable ([ADR-004](../architecture/adr-004-sibling-repo-migration.md)) |

### Why Tauri + Svelte for desktop

- Tauri uses the OS webview — smaller binary, lower memory than Electron
- Svelte compiles away the framework — smaller bundle, faster rendering in a webview
- Tauri has first-class Svelte scaffolding

### Why React Native for mobile (not Tauri mobile)

- Tauri 2.0 mobile runs a webview — janky on Android for long lists and rapid updates
- React Native renders actual native views — smooth scrolling, proper gestures
- Discord itself uses React Native for mobile
- A chat app needs performant virtual lists and real-time updates — native rendering wins

### Why not share UI components directly

Svelte components use DOM elements + CSS. React Native uses `View` + `StyleSheet`. Forcing them together through abstraction layers (like react-native-web in reverse) creates something worse on both platforms. Write the UI twice; share everything else.

---

## Repository Topology

The SDK layer lives in **standalone sibling repos**, not inside vex-chat. The monorepo contains only apps + genuinely shared vex-chat-specific packages.

```
~/Public/
├── vex-chat/                    (this monorepo — apps + store + ui)
│   packages/
│     store/                     — nanostores atoms; Client event wiring (@vex-chat/store)
│     ui/                        — Mitosis design primitives (.lite.tsx) (@vex-chat/ui)
│       output/svelte/           — compiled Svelte components (desktop)
│       output/react/            — compiled React components (mobile)
│       stories/                 — Storybook
│   apps/
│     desktop/                   — Tauri + Svelte; browser transport + SqliteStorage (future: tauri-plugin-sql)
│     mobile/                    — Expo + React Native; native transport + SqliteStorage (future: expo-sqlite)
│     website/                   — SvelteKit; browser transport + MemoryStorage
│
├── libvex-js/                   — Client SDK (@vex-chat/libvex) — [github.com/vex-chat/libvex-js]
├── crypto-js/                   — Crypto primitives (@vex-chat/crypto) — [github.com/vex-chat/crypto-js]
├── types-js/                    — Shared types (@vex-chat/types)  — [github.com/vex-chat/types-js]
└── spire/                       — Server                           — [github.com/vex-chat/spire]
```

**Linkage during development:** client SDK siblings are added to `pnpm-workspace.yaml` as external workspace members (`'../crypto-js'`, `'../types-js'`, `'../libvex-js'`). A single `pnpm install` from the vex-chat root resolves all inter-repo `workspace:*` dependencies via symlinks — no publish step required between edits. Sibling repos keep their own `package-lock.json` for standalone CI. Spire (server) is not workspace-linked — it runs standalone for integration testing.

See [ADR-004](../architecture/adr-004-sibling-repo-migration.md) for the migration rationale and ADR-001 for the original monorepo consolidation.

---

## What Gets Shared

### 100% shared via sibling repos (framework-agnostic TypeScript)

- **@vex-chat/types** — all interfaces, enums, API payload shapes (single `src/index.ts`, 34 exports)
- **@vex-chat/crypto** — NaCl encryption primitives (tweetnacl + ed2curve + msgpackr), `XUtils`, `xDH`, `xHMAC`, `xKDF`, `xMakeNonce`, `XKeyConvert`
- **@vex-chat/libvex** — `Client` SDK (WebSocket auth, mail, sessions, devices, servers, channels, files). Portable across node / browser / react-native via **adapter injection** (see below)

### 100% shared in monorepo (vex-chat-specific)

- **@vex-chat/store** — nanostores atoms per state slice; `bootstrap()` wires `Client` events to atoms; apps install `@nanostores/svelte` or `@nanostores/react` for framework binding

### Shared via Mitosis compilation

- **@vex-chat/ui** — design system primitives (Button, Avatar, Badge, TextInput, MessageBubble, ChannelListItem). Written once as `.lite.tsx`, compiled to Svelte and React. See `docs/design-system.md`.

### NOT shared (written per-platform)

- Screen-level layouts and navigation
- Animations and gestures
- Platform adapter + storage wiring (see below — picks which `Client.create()` adapter set to pass)
- Push notification registration
- Navigation chrome

Expected shared code: **~70% by line count**.

---

## Platform Adapter Injection

> **Status (2026-04-06):** All transport adapters (`nodeAdapters`, `browserAdapters`, `reactNativeAdapters`, `inMemoryAdapters`) are implemented. `Client.ts` is fully platform-agnostic — no Node built-in imports (`events` → `eventemitter3`, `chalk` removed, `node:os`/`node:perf_hooks` → cross-platform equivalents). Metro bundles the SDK without polyfills. Storage: `SqliteStorage` (platform-agnostic, accepts `Kysely<DB>`), `MemoryStorage`, and `createNodeStorage` (better-sqlite3 factory) are implemented. Expo-sqlite and wa-sqlite storage backends are future work.

`@vex-chat/libvex` is a single SDK that runs on Node, browsers, and React Native. Platform differences (WebSocket implementation, logger, persistence) are **injected at construction time** via `Client.create()`, not hard-coded into separate builds.

```
                    Client (monolithic, platform-agnostic)
                           │
                           │ accepts at create() time:
                           ▼
           ┌──────────────────────────────────────┐
           │  IClientAdapters { logger, WebSocket }│
           │  IStorage { sessions, prekeys, mail } │
           └──────────────────────────────────────┘
                           │
         ┌─────────────────┼──────────────────┐
         ▼                 ▼                  ▼
  nodeAdapters()    browserAdapters()   reactNativeAdapters()
  + SqliteStorage   + MemoryStorage     + MemoryStorage
  (Node/CLI/tests)  (desktop, website)  (mobile)
  via storage/node  (future: wa-sqlite) (future: expo-sqlite)
```

The `exports` map in `@vex-chat/libvex/package.json` uses **subpath exports** with **conditions** (`node`) so bundlers tree-shake platform-specific code. A React Native bundle never sees the `ws` library; a browser bundle never sees `better-sqlite3`. Node-only subpaths (`transport/node`, `storage/node`, `keystore/node`) are not in the barrel — they must be imported explicitly via subpath.

**Construction per platform:**

```ts
// apps/mobile — React Native + Expo
import { Client } from '@vex-chat/libvex'
import { reactNativeAdapters } from '@vex-chat/libvex/transport/native'
import { MemoryStorage } from '@vex-chat/libvex/storage/memory'

const client = await Client.create(privateKey, {
  adapters: reactNativeAdapters(),
}, new MemoryStorage())
```

```ts
// apps/desktop — Tauri + Svelte (runs in WebView)
import { Client } from '@vex-chat/libvex'
import { browserAdapters } from '@vex-chat/libvex/transport/browser'
import { MemoryStorage } from '@vex-chat/libvex/storage/memory'

const client = await Client.create(privateKey, {
  adapters: browserAdapters(),
}, new MemoryStorage())
```

```ts
// Tests / spire / CLI tools — Node
import { Client } from '@vex-chat/libvex'
// nodeAdapters() + createNodeStorage() are the defaults when nothing is provided
const client = await Client.create(privateKey)
```

```ts
// Unit tests — in-memory
import { Client } from '@vex-chat/libvex'
import { inMemoryAdapters } from '@vex-chat/libvex/transport/test'
import { MemoryStorage } from '@vex-chat/libvex/storage/memory'

const client = await Client.create(privateKey, {
  adapters: inMemoryAdapters(capturingLogger()),
}, new MemoryStorage())
```

The `Client` public API (`register`, `login`, `connect`, `messages.send`, `messages.retrieve`, `servers.*`, `channels.*`, events) is identical across platforms.

---

## Identity Persistence

`Client` does **not** own credential persistence — apps do. The SDK takes a `privateKey: string` and doesn't care how you got it. This keeps `Client` focused on the protocol, keeps biometric/keychain UX under app control, and respects the fact that **identity keys belong in OS keychains** (hardware-backed, biometric-gated) while protocol session state belongs in local DBs.

### The `KeyStore` contract (from `@vex-chat/types`)

```ts
export interface StoredCredentials {
  username: string
  deviceID: string
  deviceKey: string   // hex Ed25519 secret
  preKey?: string
  token?: string
}
export interface KeyStore {
  load(username?: string): Promise<StoredCredentials | null>
  save(creds: StoredCredentials): Promise<void>
  clear(username: string): Promise<void>
}
```

Apps implement `KeyStore` backed by whatever their platform provides:

| Platform | KeyStore backing |
|---|---|
| **Mobile** | `expo-secure-store` (iOS Keychain / Android Keystore) — hardware-backed, biometric-gated |
| **Desktop (Tauri)** | `tauri-plugin-keyring` — macOS Keychain, Windows Credential Manager, Linux Secret Service |
| **Browser / website** | SqliteStorage (future: wa-sqlite Kysely dialect), or skip client-side persistence |
| **Bots / CLI** | File-backed via `@vex-chat/libvex/keystore/node` (`saveKeyFile`/`loadKeyFile`) |
| **Tests** | `@vex-chat/libvex/keystore/memory` (no disk I/O) |

### Session bootstrap pattern

```ts
// App composition root
const creds = await keystore.load()

if (creds) {
  // Resume — SDK takes the raw hex key, doesn't know about keystores
  const client = await Client.create(creds.deviceKey, { adapters, storage })
  await client.connect()
} else {
  // First launch — register, then persist
  const privateKey = Client.generateSecretKey()
  const client = await Client.create(privateKey, { adapters, storage })
  const result = await client.register(username, password)
  await keystore.save({
    username,
    deviceID: result.deviceID,
    deviceKey: privateKey,
    preKey: client.keyring.preKey,
  })
}
```

The app owns the flow: load → construct → connect, or generate → register → save. `Client` is identity-agnostic; biometric prompts fire when the app calls `keystore.load()`, not hidden inside the SDK.

**Why not inject `KeyStore` into `Client`?** Different concerns (protocol vs persistence), different lifecycles (runtime vs boot-time), different backends (DB vs OS keychain), and different security postures. Industry precedent supports this split: matrix-js-sdk, Twilio, Slack, and Discord all pass credentials as primitives rather than injecting stores. See [ADR-004](../architecture/adr-004-sibling-repo-migration.md#identity-persistence-architecture) for the full reasoning.

---

## Mobile Development: Development Builds

`apps/mobile` uses **Expo Prebuild (CNG)** — `ios/` and `android/` directories are gitignored and generated by `npx expo prebuild`.

Vex mobile does not use Expo Go. Expo Go has a fixed native runtime, while Vex
mobile depends on generated native projects, config plugins, and native
packages such as Notifee, passkeys, SQLite, secure storage, and Expo Updates.

| | Local `dev` build | CI `development` APK |
|---|---|---|
| **What it is** | Custom debug app with `expo-dev-client` for local Metro work | Standalone internal APK for the development channel |
| **Native modules** | Everything in `package.json` plus generated config plugin output | Same native surface, without the dev-client launcher |
| **Entry point** | Dev-client launcher, then Metro/update target | Vex app directly |
| **Build time** | ~2-5 min first build, then incremental | Built by the mobile release-candidate workflow |
| **JS iteration speed** | Hot reload through Metro | OTA through EAS Update when native fingerprint is unchanged |
| **Xcode/Android Studio required** | Yes for local native builds | CI owns the Android build |

**Workflow:**

```bash
cd apps/mobile

# Local dev-client testing
pnpm -F mobile prebuild # Regenerates ios/ and android/ from app config + plugins
pnpm -F mobile android  # Builds and launches the local Android dev-client
pnpm -F mobile ios      # Builds and launches the local iOS dev-client
pnpm -F mobile dev      # Starts Metro for an installed dev-client
```

After the first native build, `pnpm -F mobile dev` hot-reloads JavaScript
through the Vex Developer dev-client while keeping all native modules
available.

**When to use which:**
- **Local `dev` build**: Daily mobile development against Metro and native modules.
- **CI `development` APK**: Shareable development-channel release candidate.
- **Production**: EAS Build (`eas build`) or local `npx expo prebuild --clean && xcodebuild`.

---

## State Management Pattern

`packages/store` defines nanostores atoms per state slice. `bootstrap()` wires `Client` real-time events directly to atoms and populates initial state from HTTP. Svelte apps use atoms natively (nanostores implements the Svelte store contract); React Native apps use `@nanostores/react`.

```
Client (@vex-chat/libvex)
    └── event source for
nanostores atoms (@vex-chat/store)   ← $messages, $servers, $user, etc.
    │   wired in bootstrap() — events update atoms directly
    ├── apps/desktop (Svelte)        ← $messages native Svelte store — use $messages in templates
    └── @nanostores/react            ← apps/mobile: useStore($messages)
```

**State atoms** in `packages/store`:

| Atom | nanostores type | Updated when |
|---|---|---|
| `$user` | `atom<IUser \| null>` | login / whoami |
| `$familiars` | `map<Record<string, IUser>>` | bootstrap (when familiars API exists) |
| `$messages` | `map<Record<string, IMessage[]>>` | bootstrap, incoming message (DM) |
| `$groupMessages` | `map<Record<string, IMessage[]>>` | bootstrap, incoming message (group) |
| `$servers` | `map<Record<string, IServer>>` | bootstrap, serverChange event |
| `$channels` | `map<Record<string, IChannel[]>>` | bootstrap per server |
| `$permissions` | `map<Record<string, IPermission>>` | bootstrap per server |
| `$devices` | `map<Record<string, IDevice[]>>` | bootstrap (when familiars API exists) |
| `$onlineLists` | `map<Record<string, IUser[]>>` | server channel presence events |
| `$avatarHash` | `atom<number>` | avatar upload (cache-busting) |
| `$verifiedKeys` | `atom<Set<string>>` | markVerified/unmarkVerified (localStorage-persisted) |

**`packages/store`** — event wiring lives in `bootstrap()`:

```ts
// packages/store/src/bootstrap.ts
import { Client } from '@vex-chat/libvex'

export async function bootstrap(privateKey, options, storage) {
  const client = await Client.create(privateKey, options, storage)
  $client.set(client)

  client.on('connected', (user) => $user.set(user))
  client.on('message', (msg) => {
    // msg: IMessage — Client decrypts internally; msg.message is plaintext, msg.decrypted is the flag
    if (!msg.decrypted) return // skip mail we couldn't decrypt
    if (msg.group) {
      const prev = $groupMessages.get()[msg.group] ?? []
      $groupMessages.setKey(msg.group, [...prev, msg])
    } else {
      const me = $user.get()
      const key = me && msg.authorID === me.userID ? msg.readerID : msg.authorID
      const prev = $messages.get()[key] ?? []
      $messages.setKey(key, [...prev, msg])
    }
  })
  client.on('permission', (perm) => { /* ... */ })

  await client.connect()
  // ... waterfall HTTP fetch populates $user, $servers, $channels
}
```

`Client` already decrypts inside the SDK (`Client.readMail()` runs X3DH and `nacl.secretbox.open` inline) and emits `"message"` with `IMessage { decrypted: boolean, message: string, ... }`. The store layer receives plaintext and fans it out to atoms.

**Logout lifecycle:** `resetAll()` (exported from `@vex-chat/store`) sets every atom back to its default value. Call it on logout before clearing localStorage credentials to prevent stale data from leaking to the next user session. `$verifiedKeys` is intentionally NOT reset — verified fingerprints are device-scoped and persist across accounts.

**`apps/desktop`** — nanostores atoms are native Svelte stores (implement `.subscribe()`):

```svelte
<script>
  // apps/desktop/src/lib/store/index.ts re-exports without $ prefix:
  // export { $messages as messages, $user as user } from '@vex-chat/store'
  import { messages, user } from '$lib/store'
</script>

{#each $messages[currentUserID] ?? [] as mail}
  <!-- $messages = Svelte auto-subscribed value of the `messages` atom -->
{/each}
```

**`apps/mobile`** — `@nanostores/react`:

```ts
import { useStore } from '@nanostores/react'
import { $messages } from '@vex-chat/store'

// In React Native component
const messages = useStore($messages)
// Re-renders only when atom changes — no Context, no Redux
```

> **Why nanostores?** 265–800 bytes. Zero dependencies. nanostores atoms implement the Svelte store contract (`.subscribe()`) so no adapter package is needed for Svelte — atoms work directly with the `$` reactive syntax. `@nanostores/react` provides `useStore()` backed by `useSyncExternalStore`. Used by Astro for cross-framework state. Eliminates the custom EventEmitter VexStore class and hand-rolled adapter boilerplate entirely.

> **No client-side pre-validation.** `Client` methods throw typed errors or return discriminated results. The UI renders these directly. Duplicating server rules client-side creates drift — avoided by design.

---

## Relationship to Original vex-chat Repos

| Original repo | Current role | Notes |
|---|---|---|
| [`types-js`](https://github.com/vex-chat/types-js) | `@vex-chat/types` (sibling) | Modernized to TS 6 + pure ESM; 34 shared type exports |
| [`crypto-js`](https://github.com/vex-chat/crypto-js) | `@vex-chat/crypto` (sibling) | Modernized to TS 6 + ESM + Vitest; still tweetnacl-backed |
| [`libvex-js`](https://github.com/vex-chat/libvex-js) | `@vex-chat/libvex` (sibling) | Client SDK; **adapter injection for node/browser/react-native** ([ADR-004](../architecture/adr-004-sibling-repo-migration.md)) |
| [`spire`](https://github.com/vex-chat/spire) | Server (sibling) | TS 6 + runs TypeScript natively (no build step) |
| `vex-desktop` (Electron+React) | `apps/desktop` (Tauri+Svelte) | New shell + framework |
| — | `apps/mobile` (Expo + RN) | New — mobile client, Prebuild workflow |
| — | `apps/website` (SvelteKit) | New — marketing / download site |
| — | `packages/ui` (Mitosis) | New — shared design primitives |
| — | `packages/store` | New — framework-agnostic state (nanostores) |

---

See also: [packages.md](../reference/packages.md) for package APIs and dependency graph, [design-system.md](design-system.md) for the Mitosis component pipeline.
