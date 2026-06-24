# ADR-013: Entitlement Tiers

**Status:** Proposed
**Date:** 2026-06-23
**Deciders:** @dream
**Supersedes:** None

---

## Context

Vex currently treats all authenticated users the same in the UI. The protocol
server already enforces some resource behavior directly, including attachment
storage, notification subscriptions, call signaling, device records, server
permissions, and invite handling. The UI repo centralizes protocol access
through `VexService`, so it has a single place to hydrate account state and
present feature availability across mobile and desktop.

Future client behavior needs a stable way to distinguish three account tiers:

- `free`
- `plus`
- `pro`

The tier check must not become scattered across screens. It also must not rely
only on client-side checks, because attachment size, device count, server
customization, and relay allocation are server-controlled resources. Clients
can optimize UX, but the server remains the source of truth.

---

## Decision

Introduce a first-class entitlement model shared by the Vex UI apps and the
protocol server. The tier name is a coarse label. Concrete behavior is governed
by explicit capability keys and numeric limits returned by the server.

### Tier identifiers

The canonical tier identifiers are:

```typescript
export type AccountTier = "free" | "plus" | "pro";
```

Tier ordering is:

```text
free < plus < pro
```

Apps may use this ordering for display and simple guards, but resource behavior
must use server-provided limits rather than hardcoded assumptions.

### Entitlement shape

The server returns an account entitlement document during session hydration:

```typescript
export interface AccountEntitlements {
    capabilities: Record<string, boolean>;
    limits: Record<string, number>;
    refreshedAt: string;
    tier: AccountTier;
}
```

Capability keys are stable strings. Initial keys:

```text
attachments.encrypted_uploads
calls.relay_priority
devices.additional_slots
identity.profile_customization
servers.custom_invites
servers.custom_profile
servers.extended_assets
```

Limit keys are also stable strings. Initial keys:

```text
attachments.max_encrypted_bytes
devices.max_trusted_devices
identity.max_profile_assets
servers.max_custom_invites
servers.max_emoji_slots
servers.max_sticker_slots
```

Unknown capability and limit keys must be ignored by older clients. Missing
keys must fall back to the `free` baseline.

### Free baseline

`free` is the compatibility baseline. If entitlement hydration fails, clients
render the account as `free` until a later refresh succeeds.

The `free` baseline must preserve:

- Account registration and sign-in
- Device-key authentication and passkey flows
- Direct and group encrypted messaging
- Basic encrypted attachments
- Basic voice-call signaling
- Push notification subscription
- Invite preview and redemption
- Local message retention preferences

### Plus and Pro behavior

`plus` and `pro` grant additional capabilities and higher limits. The client
does not embed the exact values in screen code. Screens ask the store for
resolved limits and capabilities:

```typescript
const maxBytes = entitlementLimit("attachments.max_encrypted_bytes");
const canCustomize = hasCapability("identity.profile_customization");
```

This keeps mobile, desktop, and future web surfaces consistent while allowing
the server to adjust limits without requiring a client release.

### Store ownership

Add a new `packages/store/src/domains/entitlements.ts` domain:

```typescript
export const $entitlementsWritable = atom<AccountEntitlements>({
    capabilities: {},
    limits: {},
    refreshedAt: "",
    tier: "free",
});

export const $entitlements = readonlyType($entitlementsWritable);
```

`packages/store/src/index.ts` exports:

```typescript
export { $entitlements } from "./domains/entitlements.ts";
export type { AccountEntitlements, AccountTier } from "./domains/entitlements.ts";
```

`VexService` owns all writes to `$entitlementsWritable`.

### Hydration flow

`VexService.populateState()` fetches entitlements near the start of account
hydration, after authentication is established and before resource-heavy
history, attachment, call, or server customization screens depend on tier
state.

Hydration behavior:

1. Set `free` defaults during `resetAll()`.
2. Fetch entitlements from the authenticated server.
3. Validate the response with a shared schema.
4. Publish the result to `$entitlementsWritable`.
5. Continue normal state population if entitlement fetch fails.

Entitlement fetch failure must not sign the user out.

### Server enforcement

Every limit that protects a shared resource is enforced server-side. Client
checks are only preflight UX.

Server-enforced examples:

- Encrypted attachment byte limit
- Trusted device limit
- Custom profile asset count
- Server asset slots
- Custom invite count
- Relay-priority eligibility

The server should return structured errors when a request exceeds an
entitlement:

```typescript
export interface EntitlementError {
    code: "ENTITLEMENT_REQUIRED" | "ENTITLEMENT_LIMIT_EXCEEDED";
    limitKey?: string;
    requiredCapability?: string;
    tier: AccountTier;
}
```

`VexService` converts these errors into `OperationResult` messages and refreshes
entitlements once before reporting failure, so clients recover from stale local
state.

### Client guard pattern

Screens do not compare tier strings directly except for display. They use store
selectors:

```typescript
hasCapability("servers.custom_profile");
entitlementLimit("attachments.max_encrypted_bytes");
```

This avoids policy duplication and keeps future tiers or temporary overrides
from requiring UI rewrites.

### Cache behavior

Entitlements are session state, not durable identity secrets.

- Keep entitlements in memory for the active client session.
- Persisting a short-lived cache is optional for launch performance.
- Cached entitlements must be treated as advisory until the server refreshes.
- Server rejections always override cached client state.

### Compatibility

Older clients that do not know about entitlements continue to operate at the
`free` baseline because server defaults must allow baseline protocol behavior.

Newer clients talking to older servers must treat missing entitlement endpoints
as `free`.

---

## Consequences

### Positive

- **Single entitlement surface.** Mobile and desktop read the same store domain
  instead of duplicating tier checks in screens.
- **Server remains authoritative.** Resource limits are enforced where the
  resource is allocated.
- **Extensible.** New features can add capability keys without changing the
  tier enum or old clients.
- **Fail-safe.** Missing or stale entitlement state falls back to the baseline
  instead of granting unknown capabilities.

### Negative

- **More protocol surface.** The server needs an entitlement endpoint, schema,
  storage, and structured errors.
- **More store state.** Hydration now includes another account domain.
- **Preflight can drift.** Client-side checks can be stale. The server-side
  rejection path is required and must be tested.

---

## Migration

1. Add shared entitlement types and schemas in the protocol repo.
2. Add an authenticated entitlement endpoint to Spire.
3. Enforce baseline resource limits in Spire before exposing client UI.
4. Add the entitlements domain to `@vex-chat/store`.
5. Hydrate entitlements in `VexService.populateState()`.
6. Replace local hardcoded checks with capability and limit selectors.
7. Add tests for `free`, `plus`, `pro`, missing endpoint fallback, stale cache,
   and server rejection refresh.

---

## References

- [ADR-009: VexService facade](./adr-009-vexservice-facade.md)
- [ADR-010: Domain atom consolidation](./adr-010-domain-atom-consolidation.md)
- [ADR-011: Platform config ownership](./adr-011-platform-config-ownership.md)
