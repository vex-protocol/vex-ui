# Glossary

Central definitions for terms used across Vex documentation. Alphabetical.

---

| Term | Definition | Detail in |
|------|-----------|-----------|
| **action token** | Single-use UUID issued by the server for privileged operations (register, file upload, device connect, etc.). The client must NaCl-sign the token bytes with their device key before submitting. Expires in 10 minutes. Not a JWT — consumed on first use, stored in memory only | [vex-overview.md](vex-overview.md) |
| **argon2id** | Memory-hard password hashing algorithm used for every account password in the greenfield Spire schema. Spire uses a random salt, 64 MiB of memory, three iterations, and one lane | [auth-comparison.md](explanation/auth-comparison.md) |
| **ciphertext** | The encrypted form of a message. The server stores only ciphertext — it cannot read, search, or index message content | [vex-overview.md](vex-overview.md) |
| **device** | A registered client instance identified by its own signing key pair. Each user may have multiple approved devices. Mail is addressed to a specific device, not a user, and the private key never leaves that device | [vex-overview.md](vex-overview.md) |
| **device key** | The signing key pair generated on one client installation. Its public half (`signKey`) is stored on Spire. Losing one key removes access to that device's local history, but another approved device or passkey can authorize a replacement device | [vex-overview.md](vex-overview.md) |
| **double ratchet** | Session key advancement protocol in which sending and receiving chains derive a new message key for each message and advance Diffie-Hellman state when the remote key changes | [journeys.md](ops/journeys.md) |
| **Ed25519** | The signing scheme used for device identity | [vex-overview.md](vex-overview.md) |
| **familiar** | A user you have previously exchanged messages with. The original server tracked familiars server-side via `users.familiars()`. The current client populates `$familiars` from local message history instead | [journeys.md](ops/journeys.md) |
| **key bundle** | The set of public keys fetched from the server to establish an encrypted session with a device: `{ signKey, preKey, otk? }`. Fetched via `POST /device/:id/keyBundle` | [vex-overview.md](vex-overview.md) |
| **KDF** | Key Derivation Function. Used to derive a shared session key from the raw Diffie-Hellman output during X3DH. Ensures the session key has the right length and entropy | [vex-overview.md](vex-overview.md) |
| **mail** | The encrypted message format in Vex. Contains `{ nonce, cipher, header, mailType, recipient, sender, group?, authorID, readerID }`. Addressed to a device ID, not a user. The server is a relay — mail is deleted after the recipient fetches it | [vex-overview.md](vex-overview.md) |
| **NaCl** | Networking and Cryptography library (pronounced "salt"). The default crypto profile uses TweetNaCl-compatible Ed25519, X25519, and XSalsa20-Poly1305 primitives | [vex-overview.md](vex-overview.md) |
| **nonce** | A fresh value used exactly once with an encryption key; Vex uses 24-byte XSalsa20 nonces | [vex-overview.md](vex-overview.md) |
| **OTK (one-time key)** | Single-use Curve25519 key uploaded in batches by devices. Consumed during X3DH session establishment — the server deletes the OTK after handing it to the sender. Provides forward secrecy for the initial key exchange | [vex-overview.md](vex-overview.md) |
| **permission** | A database record granting a user access to a server resource. Has a `powerLevel` (0 = member, 1 = default member, 50 = moderator, 100 = admin). Created when joining via invite | [vex-overview.md](vex-overview.md) |
| **power level** | Integer (0–100) indicating a user's privilege within a server. Admin = 100, default member = 1. Controls who can create/delete channels, kick users, etc. | [journeys.md](ops/journeys.md) |
| **pre-key** | Medium-term Curve25519 public key, signed by the device's signKey. Part of the key bundle. Unlike OTKs, pre-keys are not consumed — they serve as a fallback when no OTKs are available | [vex-overview.md](vex-overview.md) |
| **signKey** | The Ed25519 public signing key of a device. Spire uses it to verify device proof and clients use it in session fingerprints | [vex-overview.md](vex-overview.md) |
| **SPK (server private key)** | The server's own NaCl Ed25519 signing key pair. The public half is shared with clients for verifying server-signed payloads. The private half is the `SPK` environment variable. Separate from the JWT secret | [vex-overview.md](vex-overview.md) |
| **X3DH** | Extended Triple Diffie-Hellman — the key agreement protocol used to establish encrypted sessions between devices. Combines identity keys, pre-keys, ephemeral keys, and optionally OTKs to derive a shared secret without both parties being online simultaneously. Same approach as Signal | [vex-overview.md](vex-overview.md) |

---

See also: [vex-overview.md](vex-overview.md) for the full cryptographic protocol.
