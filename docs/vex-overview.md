# Vex Platform Overview

Vex is a self-hostable, end-to-end encrypted chat platform. The active code is
split across two workspaces:

| Workspace | Contents |
|---|---|
| `vex-protocol` | Spire server, shared schemas, cryptography, libvex SDK, and CLI |
| `vex-ui` | Svelte desktop/web client, React Native mobile client, and shared state layer |

All packages are released under AGPL-3.0-or-later, with commercial licensing
available from Vex Heavy Industries LLC.

## Security Goals

- Message content is encrypted on the sending device and decrypted only on
  recipient devices.
- Every installation has a distinct signing key and receives separately
  encrypted mail.
- Spire stores account, device-directory, routing, and delivery metadata, but
  does not receive plaintext message content or client private keys.
- Passwords authenticate accounts; optional passkeys provide recovery and
  supplementary authentication; approved device keys establish device trust.

End-to-end encryption does not make Spire irrelevant to trust. A compromised
server can observe metadata and can substitute entries in the public device
directory. Session fingerprints therefore remain the defense against a
malicious-directory attack until the protocol gains key transparency.

## Client Architecture

`@vex-chat/libvex` owns protocol operations, cryptographic sessions, network
transport, and encrypted local storage. `@vex-chat/store` wraps it with a single
`VexService` facade and readonly state atoms. Desktop and mobile supply platform
adapters for WebSocket, keychain, database, notifications, and passkeys.

Private device keys and local database keys live in separate platform keychain
slots. Ordinary sign-out clears tokens and runtime state without pretending to
delete the approved device identity. Removing a saved account from a device is a
separate destructive action.

## Authentication

The first account is created with a username, a password, and proof of the new
device signing key. Password sign-in and account creation are different protocol
intents, so a mistyped sign-in cannot register a new account.

The available authenticators have distinct jobs:

- **Password:** required at registration and available for explicit sign-in.
- **Passkey:** optional after registration; can reset a forgotten password and
  assist with adding or recovering a device after user-verified WebAuthn.
- **Approved device key:** restores a trusted local session by signing a
  server challenge and approves pending devices.

New devices first prove the password or a passkey, then wait for approval from
an existing device unless passkey recovery completes the request. Clients show
a short comparison code derived from the requesting key before approval.

See [Spire authentication model](explanation/auth-comparison.md) for the full
session, recovery, and failure behavior.

## Cryptographic Profiles

The default `tweetnacl` profile uses Ed25519 device signatures, X25519 key
agreement, and XSalsa20-Poly1305 authenticated encryption. The optional `fips`
profile uses P-256 ECDSA/ECDH and AES-GCM through Web Crypto. A client and server
must use the same profile.

For a new pairwise session, the sender retrieves the recipient device's signed
prekey and, when available, one one-time prekey. Signatures are verified before
key agreement. The resulting message key is domain-separated into independent
payload-encryption and envelope-authentication subkeys. Subsequent messages use
ratcheted session state stored only on clients.

Each recipient device receives its own encrypted mail envelope. Spire validates
the authenticated sender and intended recipient, stores ciphertext for offline
delivery, and removes mail after it is fetched and acknowledged according to the
delivery flow.

## Server Boundaries

Spire is authoritative for:

- usernames, password hashes, passkey public credentials, and approved devices;
- public prekeys and one-time prekeys;
- server, channel, membership, permission, invite, and billing metadata;
- encrypted mail routing, file routing, and notification subscriptions.

Spire does not hold device private keys, message plaintext, or local ratchet
state. Uploaded message attachments are encrypted by clients before transport;
avatars and custom server assets are intentionally public application media.

## Core HTTP Flows

| Route | Purpose |
|---|---|
| `POST /register` | Explicit account creation or pending device enrollment |
| `POST /auth` | Username and password sign-in |
| `POST /auth/device` and `/verify` | Approved-device challenge-response |
| `POST /auth/passkey/begin` and `/finish` | User-verified passkey ceremony |
| `PATCH /user/:id/password` | Current-password change or fresh-passkey reset |
| `GET /user/:id/devices` | List the account device cluster |
| `POST /mail` and `/mail/batch` | Submit encrypted mail |
| `WS /socket` | Authenticated realtime notifications and delivery signals |

The protocol package generates the complete OpenAPI and AsyncAPI artifacts from
shared Zod schemas. Prefer those artifacts over duplicating endpoint payloads in
client code.

## Operational Privacy

Production requires TLS at the reverse proxy, an explicit browser CORS allowlist,
a dedicated random JWT secret, and correctly configured WebAuthn relying-party
origins. Access logs redact UUID and device-key path material. Rate limits cover
global traffic, account auth, password updates, and uploads.

Spire necessarily observes source IPs at the network boundary while serving a
request, even when it does not persist them. Operators must configure proxy and
application logging consistently with their privacy policy.

For the detailed trust assumptions and residual risks, see the protocol
repository's `docs/security/threat-model.md`.
