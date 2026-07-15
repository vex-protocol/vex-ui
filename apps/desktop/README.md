# Vex Desktop

The Tauri desktop client has separate development and production flavors. They
can be installed side by side without sharing app data, WebView storage,
credentials, database keys, or deep-link ownership.

| Flavor      | App name        | Bundle identifier      | Default server |
| ----------- | --------------- | ---------------------- | -------------- |
| Development | Vex Development | `com.vex-chat.app.dev` | `dev.vex.wtf`  |
| Production  | vex-chat        | `com.vex-chat.app`     | `api.vex.wtf`  |

## Passkeys on macOS

The bundled WebView has a `tauri://localhost` origin, so macOS cannot perform a
WebAuthn ceremony for the Spire relying-party domain from that page. Desktop
passkey registration opens Spire's first-party HTTPS bridge in the system
browser using a short-lived, single-purpose handoff. Vex watches the
authenticated request and updates the passkey list when the browser finishes.

## Commands

Run the development flavor with Tauri and Vite hot reload:

```sh
pnpm desktop
```

Build, install, and launch the macOS development flavor:

```sh
pnpm desktop:dev
```

Build without installing:

```sh
pnpm desktop:dev:build
pnpm desktop:prod:build
```

## CI packages

The `Desktop - Package` workflow builds native installers whenever desktop or
shared store code changes on a pull request or on `development` and `master`.
Development targets the development server, while `master` targets production;
a manual run can select either flavor explicitly.

Each run uploads separate artifacts for macOS Apple Silicon (`.dmg`), macOS
Intel (`.dmg`), Windows x64 (`.msi` and NSIS `.exe`), and Linux x64 (`.deb`).
Every artifact also contains `SHA256SUMS.txt` and `manifest.json` so downloaded
installers can be checked before use.

CI packages are currently unsigned test builds. Public distribution still
requires Apple Developer ID signing and notarization for macOS and a trusted
code-signing certificate for Windows.

Install and launch an existing flavor explicitly:

```sh
pnpm desktop:dev:install
pnpm desktop:prod:install
```

Packaged development and production builds use Cargo's release profile. This
gives each installed app its real macOS bundle identity for notifications,
Keychain, and other native services. `pnpm desktop` still uses Cargo's debug
profile with Vite hot reload. The build wrapper pins each flavor to its expected
server and clears proxy overrides before packaging, so a production artifact
cannot accidentally target development.

Desktop and mobile launcher icons are generated together from
`assets/vex_icon.svg` with platform-specific safe-area padding. Run
`pnpm icons:regen` from the repository root after changing the mark. Development
builds use the ice-blue mark; production builds use the red mark.

macOS installs default to `/Applications`. Set `VEX_DESKTOP_INSTALL_DIR` to use
another directory. The installer verifies bundle identifiers before replacing
an existing app and restores the previous bundle if installation fails.

On macOS, development builds automatically use an installed Apple Development
certificate for team `UBG5MM55LT`. Stable signing lets Keychain recognize new
builds as the same app, so reading the saved device and database keys does not
repeatedly request the Mac login password. Set
`VEX_DESKTOP_SIGNING_IDENTITY` (or Tauri's `APPLE_SIGNING_IDENTITY`) to override
the selected certificate. If no Apple identity is available, the installer
falls back to ad-hoc signing and warns that Keychain may prompt after rebuilds.

The first launch after replacing an ad-hoc build may ask once for access to the
legacy Keychain entries. After that read, Vex copies them into versioned slots
owned by the stable signed app, so subsequent launches do not depend on a
repeated password allowance. Cancelling access is treated as an error and never
as a missing database key.
