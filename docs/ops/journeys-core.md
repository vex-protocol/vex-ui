# User Journeys: Core (1–6)

Registration, login, bootstrap, send/receive messages, search and add contacts. These are the foundation — everything else builds on them.

> For the journey inventory and feature coverage matrix, see [journeys.md](journeys.md). For journeys 7–16, see [journeys-features.md](journeys-features.md).

---

## 1. Registration

**Goal:** Create a Vex account and device, ready to send encrypted messages.

**Why this is complex:** Unlike most apps, registration generates cryptographic keys on the user's device. The server never sees the private key. The userID itself is derived from a cryptographic signature, not server-assigned. This is the foundation of the "no surveillance by design" guarantee.

### Stages

```
Trigger          →  Key Generation  →  Server Handshake  →  Account Ready
"I want to try"     (invisible)        (token + sign)       "I can chat"
```

### Flow

| Stage | User Action | System Action | Emotional State |
|-------|-------------|---------------|-----------------|
| **Trigger** | Clicks "Register" | Shows registration form | Curious |
| **Username** | Types username (3–19 chars) | Old client: real-time availability check via `users.retrieve()`. New client: validates format only, server rejects duplicates on submit | Exploring, impatient if taken |
| **Password** | Types password + confirmation | Validates match and minimum length | Routine |
| **Key generation** | Invisible (no user action) | Generates Ed25519 signing key pair + X25519 pre-key pair locally. Private key stored on device, never transmitted | Unaware (good) |
| **Token exchange** | Invisible | `GET /token/register` → receives UUID token. Client NaCl-signs the token bytes with the new device key | Unaware |
| **Submit** | Clicks "Chat" / "Register" | `POST /register` with an explicit `create-account` intent and signed payload. Server verifies the signature, validates the password, hashes it with Argon2id, and atomically creates the user, device, and pre-key records | Waiting (loading spinner) |
| **Auto-login** | Invisible | Uses the returned one-hour bearer, then saves the device key and local database key in separate platform keychain slots | Unaware |
| **Ready** | Sees main app | Bootstraps state (see Journey 3) | Satisfied, ready to explore |

### Differences: Old vs New

| Aspect | Old (vex-desktop) | New (monorepo) |
|--------|-------------------|----------------|
| Username check | Real-time availability via HTTP as user types | Deferred to submit (server rejects 409) |
| Password hash | PBKDF2-SHA512, 1000 iterations | argon2id (memory-hard, brute-force resistant) |
| Key storage | Keyfile on disk (encrypted with optional password via NaCl secretbox) | Platform keychain/SecureStore with separate device and database keys |
| Random username | BIP39 mnemonic button | Not implemented |
| Sound effects | `unlockFX` on success, `errorFX` on failure | Not implemented |
| Pre-key submission | Included in registration payload | Same |
| OTK batch | Submitted immediately after registration (100 keys) | Submitted during bootstrap |

### Pain Points

- **No username availability feedback.** New client doesn't tell you the name is taken until you submit. The old client checked in real-time.
- **Recovery has an intentional hard boundary.** A passkey or another approved device can recover access. Losing every approved device and every passkey leaves no operator recovery path.

### Opportunities

- Add real-time username availability check back (low effort, high UX impact)
- Implement an encrypted device-transfer flow for users who prefer direct migration
- Explain the recovery boundary when the user removes their last passkey

---

## 2. Login

**Goal:** Resume an existing session and reconnect to the real-time stream.

### Stages

```
Trigger          →  Credential Check  →  WebSocket Connect  →  Ready
"I want to chat"    (password verify)     (challenge-response)   "I'm back"
```

### Flow

| Stage | User Action | System Action | Emotional State |
|-------|-------------|---------------|-----------------|
| **Trigger** | Opens app or navigates to `/login` | Checks for existing JWT in cookie/storage. If valid, skips to bootstrap | Anticipation |
| **Credentials** | Types username + password, or explicitly chooses a passkey | Password uses `POST /auth`. Passkey uses a user-verified WebAuthn ceremony and then proves or enrolls the local device. User/device bearers expire after one hour | Routine |
| **Device auth** | Invisible | If device key exists: server sends 32-byte NaCl challenge over WebSocket. Client signs with Ed25519 device key. Server verifies against stored public key | Unaware |
| **Ready** | Sees conversations | Bootstraps state (see Journey 3) | Satisfied |

### Differences: Old vs New

| Aspect | Old | New |
|--------|-----|-----|
| Auto-login | Checks cookie via `whoami()` on mount | Same pattern |
| Key rotation | If 470 error (key conflict): backs up old key, generates new, retries | `$keyReplaced` flag triggers re-registration prompt |
| Device connect | Separate `POST /device/:id/connect` → device JWT cookie | Challenge-response handshake built into WebSocket |
| Retry on failure | Auto-retry after 5 seconds on 502 | No auto-retry yet |

### Pain Points

- **No auto-retry.** Old client retried on 502; new client shows error and stops.
- **No out-of-band recovery.** The forgot-password flow requires an enrolled passkey because Vex has no verified email or phone channel.

---

## 3. App Bootstrap

**Goal:** Load all state so the UI is populated when the user sees the main screen.

This is invisible to the user but critical to perceived performance. The bootstrap sequence determines how long the user stares at a loading spinner.

### Waterfall (current monorepo — `packages/store/bootstrap.ts`)

```
0. Messages persist in SqliteStorage (loaded automatically by Client)
1. Create VexClient         → $client.set(client)
2. Wire real-time events    → mail → $messages, serverChange → $servers
3. client.connect()         → WebSocket + challenge handshake
4. client.whoami()          → $user.set(user)
5. client.listServers()     → $servers.set(...)
6. For each server:
   └─ client.listChannels() → $channels.setKey(serverID, channels)
7. Messages auto-persist via IStorage (SQLite)
8. client.fetchInbox()      → add pending offline messages to atoms + persist
9. [MISSING] Fetch familiars
10. [MISSING] Fetch permissions per server
```

### Waterfall (old vex-desktop — `ClientLauncher.tsx`)

```
1. client.connect()
2. client.me.user()           → setUser()
3. client.sessions.retrieve() → setSessions()
4. client.users.familiars()   → setFamiliars()
5. POST /deviceList           → addDevices()
6. For each familiar:
   └─ client.messages.retrieve(userID) → dmAddMany()
7. client.servers.retrieve()  → setServers()
8. For each server:
   ├─ client.channels.retrieve(serverID) → addChannels()
   └─ For each channel:
       └─ client.messages.retrieveGroup(channelID) → groupAddMany()
9. client.permissions.retrieve() → setPermissions()
10. setApp("initialLoad", false) → loading spinner gone
```

### Gap Analysis

The new bootstrap is missing:
- **Familiars list** — old client had `users.familiars()` returning all users you've exchanged messages with. New server has no equivalent endpoint.
- **Permissions** — old client fetched all permissions to know which servers you're admin of. New bootstrap doesn't do this.

DM history is now handled via **SQLite persistence** (SqliteStorage) — messages are loaded from the local SQLite database on startup (step 0) and persisted as they arrive (step 7). The server still uses a relay model (delete after fetch), but offline messages are fetched via `fetchInbox()` (step 8) and persisted locally.
- **Online presence** — old client polled `channels.userList()` every 30 seconds. New `$onlineLists` atom exists but isn't wired.

### Pain Points

- Bootstrap is sequential (waterfall). Each server's channels are fetched one at a time. Could be parallelised with `Promise.all`.
- No loading progress indicator (just a spinner). Old client at least transitioned through a `/launch` route.
- If any step fails, the whole bootstrap may silently leave state incomplete.

---

## 4. Send Direct Message

**Goal:** Send an encrypted message to another user that only they can decrypt.

This is the core journey. Everything else exists to support it.

### Stages

```
Compose  →  Key Exchange (if first msg)  →  Encrypt  →  Send  →  Confirm
"Hey"       X3DH with recipient device       NaCl        WS       "Delivered"
```

### Flow

| Stage | User Action | System Action | Emotional State |
|-------|-------------|---------------|-----------------|
| **Navigate** | Clicks on a conversation or searches for user | Loads thread from `$messages[userID]` | Intentional |
| **Compose** | Types message, presses Enter | — | Focused |
| **Resolve device** | Invisible | `client.listDevices(targetUserID)` → sends to all devices via `Promise.allSettled` | Unaware |
| **Key exchange** | Invisible (first message only) | Fetches recipient's key bundle (`POST /device/:id/keyBundle`). Performs X3DH: DH(identity, preKey) + DH(ephemeral, identity) + DH(ephemeral, preKey) [+ DH(ephemeral, OTK)]. Derives shared secret via KDF. OTK consumed server-side | Unaware |
| **Encrypt** | Invisible | `nacl.secretbox(plaintext, nonce, sessionKey)`. Builds mail payload with cipher, nonce, header | Unaware |
| **Send** | Invisible | `POST /mail` or WebSocket resource message. Server stores ciphertext, notifies recipient if online | Brief wait |
| **Confirm** | Message appears in thread | Success response from server. Message added to `$messages` | Satisfied |

### Error Paths

| Error | Old Client | New Client |
|-------|------------|------------|
| Recipient has no devices | Error message in chat | `sendError = 'Recipient has no registered devices.'` |
| Encryption failure | Message marked as failed (red icon) | Error string displayed above input |
| Network error | Toast notification | `catch(err) → sendError = err.message` |
| Session mismatch (HMAC fail) | Auto-heals: creates new session, sends "RETRY_REQUEST" | Not implemented — would silently fail |

### Differences: Old vs New

| Aspect | Old | New |
|--------|-----|-----|
| Multi-device delivery | Sends to ALL devices of recipient (fan-out) + forwards to sender's other devices | Same — `Promise.allSettled` over all devices + forwards to sender's other devices |
| Session management | Full double-ratchet with HMAC verification, auto-healing, and DB-persisted sessions | Ratcheted send/receive chains with authenticated envelopes and persisted local session state |
| Message forwarding | Forwarded to sender's other devices so they see their own sent messages | Same — forwards to sender's other devices (excludes current device via `loadCredentials().deviceID`) |
| Optimistic UI | Message added to outbox immediately, removed on confirm | Message only appears after server confirms |
| File embedding | `{{name:fileID:key:mimeType}}` syntax in message body | Implemented with attachment previews and retry-safe composer state |
| Sound | `notifyFX` on send | None |

### Pain Points

- ~~**Single-device delivery.**~~ Fixed — sends to all recipient devices via `Promise.allSettled`.
- ~~**No message forwarding.**~~ Fixed — forwards to sender's other devices.
- **No optimistic UI.** Message doesn't appear until server confirms, making the app feel slow.
- **No retry on failure.** Old client could auto-heal broken sessions. New client just shows an error.

---

## 5. Receive Direct Message

**Goal:** See incoming messages in real-time without manual refresh.

### Flow

| Stage | System Action | User Experience |
|-------|---------------|-----------------|
| **WebSocket push** | Server receives mail → looks up recipient device in connection manager → sends `{ resource: 'mail', ...payload }` over WS | Instant |
| **Decrypt** | `SessionManager.decrypt()` reconstructs shared secret from mail header, decrypts ciphertext | Invisible |
| **Store update** | `$messages.setKey(authorID, [...prev, decryptedMail])` | Message appears in thread |
| **Notification** | Desktop: Tauri notification plugin. Mobile: `@notifee/react-native` with sound + deep-link data | OS notification if app is backgrounded |

### Differences: Old vs New

| Aspect | Old | New |
|--------|-----|-----|
| Delivery | WS push + polling `POST /device/:id/mail` as backup | WS push + fetchInbox on route mount (not in bootstrap) |
| Mail deletion | Server deletes mail after fetch (relay model) | Same — server saves mail to DB AND pushes via WS. Mail persists in DB until client calls `fetchInbox()`, which fetches and deletes in a transaction. Online clients get messages via WS immediately but must still call fetchInbox to clear the server-side copy |
| Notification | Electron `new Notification()`, respects sound/mentions settings | Tauri notification (desktop), notifee (mobile) with deep-link to conversation |
| History | Messages persisted in local SQLite, encrypted at rest | Messages only in memory (nanostores). Lost on app restart |
| Session receipt | Client sends WS `receipt` message with nonce → server deletes mail | No explicit receipt. Mail remains in DB until `fetchInbox()` is called. WS push is a delivery shortcut, not a deletion trigger. This means mail for online clients accumulates in the DB — a gap in the relay model |

### Pain Points

- **No persistent message history.** Close the app, lose all messages. The old client had local SQLite with at-rest encryption. This is the single biggest UX regression (story `message-persistence` in roadmap).
- **No offline queue.** If the recipient is offline when the message is sent, the server stores it. The new client calls `fetchInbox()` on individual route mount (Messaging.svelte onMount, ServerChannel.svelte onMount) — but NOT during bootstrap. If the user opens the app and doesn't navigate to a conversation, missed messages sit in the server DB uncollected.
- **No read receipts.** Neither old nor new. By privacy design — read receipts reveal when you're online.

---

## 6. Search & Add Contact

**Goal:** Find another Vex user and start a conversation.

### Flow

| Stage | User Action | System Action |
|-------|-------------|---------------|
| **Search** | Types username in search bar | Desktop: `FamiliarsList.svelte` inline search with 250ms debounce → `client.searchUsers(query)`. Mobile: same SDK call with 300ms debounce → shows results |
| **Select** | Clicks on result | Navigates to DM screen for that user |
| **First message** | Types and sends | Triggers X3DH key exchange (Journey 4) |

### Differences: Old vs New

| Aspect | Old | New |
|--------|-----|-----|
| Search | `client.users.retrieve(username)` with real-time green checkmark | Desktop: `FamiliarsList.svelte` inline search with debounce. Mobile: `searchUsers` with debounced results |
| Familiar list | `client.users.familiars()` returns all past contacts | `$familiars` atom exists but not populated from server |
| Contact management | No explicit "add friend" — sessions auto-created on first message | Same implicit model |

### Pain Points

- **~~Desktop has no user search UI.~~** Fixed — `FamiliarsList.svelte` has inline search with 250ms debounce, calls `client.searchUsers()`, opens DM on selection.
- **No familiar list on new server.** The old server had a familiars endpoint. New server doesn't track who you've messaged (privacy-positive but UX-negative). The `$familiars` atom exists but is populated client-side from incoming messages, not from a server endpoint.
- **No contact list.** Neither old nor new has an explicit friend/contact system. You can only see people you've recently messaged.
