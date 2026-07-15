# Spire Authentication Model

This document describes the current greenfield authentication design shared by
Spire, `@vex-chat/libvex`, and the Vex clients. It is a description of the
implemented system, not a migration plan for older servers.

## Authenticator Roles

Vex deliberately separates three authenticators:

| Authenticator | Purpose | Result |
|---|---|---|
| Username and password | Account registration and explicit sign-in | One-hour user JWT |
| Approved device key | Restore a trusted local device session and approve another device | One-hour user JWT after Ed25519 challenge-response |
| Passkey | Optional sign-in assistance, password recovery, and device recovery/admin | Five-minute passkey-scoped JWT after user-verified WebAuthn |

Password sign-in never silently creates an account. Account creation and device
enrollment use explicit protocol intents. A passkey is optional and can be added
only after an account exists.

The clients keep the methods visually distinct. Password is the default sign-in
form, passkey use is an explicit action, and selecting a saved account after
sign-out opens credential entry instead of authenticating immediately. Normal
startup may restore a session with the approved local device key unless the user
explicitly signed out.

## Passwords

Spire hashes passwords with Argon2id using 64 MiB of memory, three iterations,
and one lane. The encoded PHC string includes a random salt.

New passwords:

- must contain 15 to 1024 characters;
- are rejected when they match compact common-password, repeated-character, or
  account-name checks;
- have no uppercase, lowercase, digit, or symbol composition rule;
- are not subject to periodic forced rotation.

Unknown usernames still run a dummy Argon2id verification before returning 401,
which reduces username enumeration through timing. Authentication and password
replacement have account/IP rate limits.

Changing a password requires an approved device session plus the current
password. Reusing the existing password is rejected.

## Passkeys and Recovery

Passkeys use WebAuthn with user verification required. Authentication challenges
are short-lived and single-use. Credential ownership is checked against the
requested account, every passkey-scoped request rechecks that the credential is
still bound, and nonzero authenticator counters must increase atomically.

A fresh passkey session can:

- reset a forgotten password;
- list account passkeys;
- inspect or remove approved devices;
- recover or reject a pending device enrollment.

It cannot act as a general device bearer. To enter chat, the client must also
prove an already approved local device key or complete a new-device approval
flow. Password reset returns the user to sign-in and does not silently open a
chat session.

Adding or removing a passkey requires an approved-device session. This keeps a
single passkey-scoped session from deleting the credential that authorized it.

Vex has no verified email address, phone number, security questions, or operator
recovery credential. Losing every approved device and every passkey makes the
account unrecoverable by design.

## Device Clusters

Every client installation has its own signing key. A new account atomically
creates the user and its first device after password validation and proof of the
new device key.

Adding another device requires either the account password or a fresh passkey
session before Spire publishes a pending request. An existing approved device
then signs a challenge containing the request ID and new signing key. Both
clients show a short code derived from the new key so the user can compare the
request before approval.

Spire limits active devices and passkeys per account. Deleting a device also
removes its prekeys, one-time keys, notification subscriptions, and passkey
approval record. Protected HTTP and WebSocket authentication recheck that the
device still exists and is not deleted.

Device approval controls provisioning, but it is not a transparency log. A
fully malicious Spire can still substitute the public device directory unless
users verify session fingerprints out of band.

## Sessions and JWTs

Spire signs JWTs with HS256 and a dedicated `JWT_SECRET`. The verifier pins the
algorithm, issuer, and audience. Runtime configuration rejects a missing or
short secret and rejects reuse of the server protocol signing key (`SPK`).

User and device-auth sessions expire after one hour. Passkey sessions expire
after five minutes and carry a distinct scope. Routes reject a bearer whose
scope is not appropriate for that operation.

JWTs are stateless. `/goodbye` is a clean authenticated boundary, while the
client is responsible for deleting its local bearer and session state. Password
changes do not revoke already issued device JWTs; deleting the device blocks it
on routes that revalidate current device state, and remaining JWT revocation is
expiry-based.

## Action Tokens

Sensitive protocol operations use random, scoped action tokens that expire after
ten minutes. Tokens are held in memory, consumed on successful validation, and
pruned whenever the store is used. The client signs operations that require
device-key proof; presenting an action token alone is not sufficient.

## Local Secret Storage

The device signing key and local database key are different secrets. Platform
keychain adapters persist them in separate slots. The encrypted local database
uses fresh nonces and purpose-separated at-rest keys; logout clears runtime
state without conflating an ordinary sign-out with deleting the trusted device
key.

See also: [Vex platform overview](../vex-overview.md) and the protocol repository's
`docs/security/threat-model.md`.
