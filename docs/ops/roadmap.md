# Roadmap

What we're building, in what order, and why. This is the strategy layer — the big picture. Technical issues and day-to-day execution live in Linear.

> Review every 6 weeks or when a release ships. Last updated: April 2026.

---

## Now — Active

| Priority | What | Notes |
|---|---|---|
| P1 | `protocol-specs` branch | Zod migration, VexService facade, domain atom consolidation, supply chain hardening. See IMPLEMENTATION_PLAN.md. |
| P1 | E2E integration tests | Two-user DM (X3DH), group messaging, auto-login on Tauri/RN, multi-device sync. |

---

## Later — Future

Important but not scoped. May never ship if priorities change. That's fine.

| Priority | What | Journey | Notes |
|---|---|---|---|
| P2 | Real-time username availability on register | 1 | UX improvement, not critical |
| P2 | Encrypted key export/import for device migration | 1, 14 | Enables moving between devices |
| P2 | BIP39 mnemonic fingerprints (replace hex) | 7 | More human-friendly for voice verification |
| P3 | Mobile deep links (`vex://` URLs) | 9 | Required for invite flow on mobile |
| P3 | Key change detection + re-verify prompt | 7 | Important for trust UX |
| P3 | Sound effects | 1, 2, 4 | Polish |
| P3 | Full settings page | 15 | Notifications, sounds, DM toggle, account management |
| P3 | Channel categories | 11 | Collapsible groups in server sidebar |
| P4 | Account deletion | 15 | Privacy feature, needs design |
| P4 | Custom emoji | 10, 11 | Nice-to-have, large effort |
| P4 | Moderation tools (kick/ban) | 11 | Needed when servers grow |
| P4 | Spire modernization (Zod, ESM, Pino) | — | Tech debt; Express 4→5 done, Winston + CJS remain |

---

## Done

Shipped **and validated** — not just merged. An item moves here when it works in practice, not when a PR lands. If a Done item regresses (bug discovered, feature incomplete, edge case missed), remove it from Done and re-add to Now with a note on what broke. The roadmap should never lie about what actually works.

Pruned periodically.

| What | Shipped |
|---|---|
| App shell: routing, layout, window chrome | v0.1 |
| Auth UI: login, register, key management | v0.1 |
| App bootstrap sequence | v0.1 |
| Nanostores state layer | v0.1 |
| SDK crypto: SessionManager, box encrypt/decrypt | v0.1 |
| Mitosis design primitives (Svelte + React) | v0.1 |
| React Native mobile scaffold | v0.1 |
| Argon2id password hashing and modern password policy | v0.1 |
| Password-first auth, optional passkeys, passkey recovery, and device approvals | v0.4 |
| Mail + keys HTTP routes and WS delivery | v0.1 |
| packages/crypto | v0.1 |
| packages/types | v0.1 |
| Desktop user search UI (FamiliarsList inline search) | v0.1 |
| Multi-device fan-out (send to all recipient devices + self-forwarding) | v0.2 |
| OTK upload device ownership verification (403 for non-owner) | v0.2 |
| Mail save error propagation (log + error frame to sender) | v0.2 |
| Auth rate limiting (10/15min on login and register) | v0.2 |
| Logout state cleanup (resetAll() clears all nanostores atoms) | v0.2 |
| Invite join atomicity (wrapped in transaction) | v0.2 |
| Local message persistence (SqliteStorage via IStorage, load/save/clear lifecycle) | v0.3 |
| Group messaging UI (GET /server/:id/members + ServerChannel fan-out) | v0.3 |
| File/image attachments (ChatInput picker, MessageBox inline rendering, upload + send) | v0.3 |
| Device management (DELETE route + SDK method + Settings UI with list/delete) | v0.3 |
| Spire Kysely migration (Knex → Kysely query builder) | v0.3 |
