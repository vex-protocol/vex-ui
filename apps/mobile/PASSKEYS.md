# Mobile passkeys

Passkeys (WebAuthn / FIDO2) let a Vex user authorize a fresh device or
remove a lost one even if every device that previously held a key is
gone. This document covers the **operator/developer** setup required
to make the ceremony actually succeed on iOS and Android.

The library that drives the platform ceremony is
[`react-native-passkey`](https://www.npmjs.com/package/react-native-passkey).

## Choosing the relying-party host

Apple and Google fetch the well-known association files from the
**RP host** — the value you put in `SPIRE_PASSKEY_RP_ID` and in the
`webcredentials:` entry in `app.json`. **It must be a host that
serves traffic.** You have three reasonable choices:

| RP host                             | Where the well-known files live                 | Future browser client at `app.<root>`?  |
| ----------------------------------- | ----------------------------------------------- | --------------------------------------- |
| **API host** (e.g. `api.vex.wtf`)   | Spire serves them directly (see below)          | ❌ wrong subdomain — would need RP swap |
| **Apex** (e.g. `vex.wtf`)           | Whatever serves the apex (static site, Workers) | ✅ apex covers `app.<root>`             |
| **Apex via proxy** (e.g. `vex.wtf`) | Apex CDN proxies `/.well-known/*` to spire      | ✅ apex covers `app.<root>`             |

For a **mobile-only** deployment the API-host route is simplest:
spire owns both the WebAuthn ceremony and the well-known files, and
there is nothing to deploy on the apex. The trade-off is that
re-rooting later (to add a browser client at `app.<root>`)
invalidates any passkeys enrolled at the API host, so plan ahead.

The rest of this doc uses `api.vex.wtf` as the RP host (the
production setup). Substitute your own host wherever you see it.

## TL;DR

1. iOS — `app.config.js` writes
   `associatedDomains: ["webcredentials:<RP host>"]` for the selected
   environment. Production defaults to `api.vex.wtf`; development
   defaults to `dev.vex.wtf`; set `VEX_PASSKEY_RP_HOST` to override.
2. Android — `app.config.js` writes the matching Digital Asset Links
   include for the selected RP host. The static `app.json` value is
   only the production base; prebuild output comes from the dynamic
   config.
3. spire — set `SPIRE_PASSKEY_RP_ID=api.vex.wtf` and
   `SPIRE_PASSKEY_ORIGINS` to the comma-separated list of expected
   origins (typically `https://api.vex.wtf` plus any
   `ios:bundle-id:…` flavors). Native-Android
   `android:apk-key-hash:<base64url>` entries are derived from
   `SPIRE_PASSKEY_ANDROID_FINGERPRINTS` and merged in automatically;
   you don't need to compute them by hand.

If any one of those three legs is missing, the system credential
manager will fail the ceremony with a "Domain mismatch" error well
before our app code runs. The wrapper in `src/lib/passkey.ts`
normalizes that to a `PasskeyError` with the platform's message.

## iOS — Apple App Site Association

Apple fetches `https://api.vex.wtf/.well-known/apple-app-site-association`
and verifies the bundle id is listed under `webcredentials.apps`:

```json
{
    "webcredentials": {
        "apps": ["TEAMID.chat.vex.mobile"]
    }
}
```

Replace `TEAMID` with your Apple Developer team identifier and
`chat.vex.mobile` with whatever bundle id is shipping (the dev
flavor uses `chat.vex.mobile.dev`). The file must be served as
`application/json` over HTTPS with a valid certificate — Apple
will _silently_ refuse a self-signed cert and the system prompt
will never appear.

After deploying the file, install a fresh build via
`npx expo prebuild -p ios && npx expo run:ios`. The prebuild step
syncs the `associatedDomains` entry into the generated
`Vex.entitlements`.

## Android — Digital Asset Links

Google fetches `https://api.vex.wtf/.well-known/assetlinks.json`
with the package name and SHA-256 signing-cert fingerprint(s):

```json
[
    {
        "relation": [
            "delegate_permission/common.get_login_creds",
            "delegate_permission/common.handle_all_urls"
        ],
        "target": {
            "namespace": "android_app",
            "package_name": "chat.vex.mobile",
            "sha256_cert_fingerprints": ["AB:CD:EF:..."]
        }
    }
]
```

For local credentials, get the fingerprint with

```sh
keytool -list -v -alias <alias> -keystore <keystore.jks>
```

and paste the colon-delimited `SHA256` value into
`sha256_cert_fingerprints`. If you have separate dev/release keys,
add an entry for each — the same JSON file can carry both.

For EAS-managed credentials, use the SHA-256 certificate fingerprint
shown by EAS for the exact package that will use the RP host. The
current production Android app uses package `chat.vex.mobile`; the
development app uses `chat.vex.mobile.dev`, and each package has its
own EAS signing certificate.

## spire — relying-party config

Set these env vars on the server before starting it:

```
SPIRE_PASSKEY_RP_ID=api.vex.wtf
SPIRE_PASSKEY_RP_NAME=Vex
SPIRE_PASSKEY_ORIGINS=https://api.vex.wtf,ios:bundle-id:chat.vex.mobile
```

The `ORIGINS` list is what `simplewebauthn` uses to validate the
`origin` field inside the assertion's `clientDataJSON`. Different
mobile platforms sign different "origin" strings:

- iOS native (Apple Passkeys via Credential Manager):
  `https://api.vex.wtf` (the RP host). Older flavors of the
  authentication services framework instead emit
  `ios:bundle-id:chat.vex.mobile`; list both if you target older OS
  versions.
- Android Credential Manager:
  `android:apk-key-hash:<base64url(SHA-256(cert))>`. **Spire derives
  these automatically** from `SPIRE_PASSKEY_ANDROID_FINGERPRINTS`
  (see "Serving the well-known files from spire" below) and merges
  them into the allowlist at request time, so the `ORIGINS` value
  you set never needs to mention them.
- Web (only relevant if you ship a browser client): the actual
  origin, e.g. `https://api.vex.wtf` or wherever the page loads
  from.

If you ever need to verify the auto-derived value (e.g. when
debugging an "RP failed" error from the mobile UI), the underlying
math is:

```sh
keytool -list -v -alias <alias> -keystore <keystore.jks> | \
    awk '/SHA256:/ {print $2}' | tr -d : | xxd -r -p | base64 | tr '+/' '-_' | tr -d '='
```

— that should match one of the entries spire computes from your
`SPIRE_PASSKEY_ANDROID_FINGERPRINTS`.

## Serving the well-known files from spire

If `SPIRE_PASSKEY_RP_ID` is the same host that fronts spire — e.g.
`api.vex.wtf` — set these three env vars and spire serves both
files itself; no separate static site needed:

```
SPIRE_PASSKEY_IOS_APP_IDS=ABCDE12345.chat.vex.mobile
SPIRE_PASSKEY_ANDROID_PACKAGE=chat.vex.mobile
SPIRE_PASSKEY_ANDROID_FINGERPRINTS=AA:BB:...:CC,DD:EE:...:FF
```

`IOS_APP_IDS` and `ANDROID_*` 404 independently when unset, so you
can configure one platform now and the other later. The routes are
mounted ahead of spire's per-IP rate limiter so periodic platform
fetches by Apple / Google CDNs are never 429'd.

For the production Docker Compose deployment, put those values in
`apps/spire/.env` next to `SPK` and `JWT_SECRET`; compose passes the
file into the `spire` service. For development, use the development
RP host, package, and EAS signing fingerprint instead:

```
SPIRE_PASSKEY_RP_ID=dev.vex.wtf
SPIRE_PASSKEY_ORIGINS=https://dev.vex.wtf,ios:bundle-id:chat.vex.mobile.dev
SPIRE_PASSKEY_ANDROID_PACKAGE=chat.vex.mobile.dev
SPIRE_PASSKEY_ANDROID_FINGERPRINTS=<dev EAS SHA-256 fingerprint>
```

After setting them and restarting spire:

```sh
curl -i https://api.vex.wtf/.well-known/apple-app-site-association
curl -i https://api.vex.wtf/.well-known/assetlinks.json
```

Both must return `200` with `Content-Type: application/json`. If
either returns `404`, the corresponding env var is missing or
nginx isn't routing `/.well-known/*` to spire.

If you instead picked an apex RP (e.g. `vex.wtf`) and the apex is
a different deployment from spire, you have two options:

1. **Proxy at the CDN** — point `vex.wtf/.well-known/*` at
   `api.vex.wtf/.well-known/*` (Cloudflare Page Rule, Worker,
   nginx `proxy_pass`, etc.). Spire keeps generating the JSON.
2. **Self-host on the apex** — commit the two JSON files into
   whatever serves the apex and don't set the spire env vars at
   all.

## Local development

For testing without owning the RP host you can:

- Run spire with `SPIRE_PASSKEY_RP_ID=localhost` and
  `SPIRE_PASSKEY_ORIGINS=http://localhost:5173` (browser dev only).
- For native testing point at a tunnel host (e.g. ngrok) and update
  all three legs (`associatedDomains`, asset links, spire env)
  consistently.

There is no usable local-dev mode for native passkeys without a
domain you control — Apple and Google both gate the ceremony on
the cryptographically-verified domain ↔ app association.
