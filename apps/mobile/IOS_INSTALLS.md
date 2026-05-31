# Local iOS installs

Use these lanes from the repo root:

```sh
pnpm ios:dev:install
pnpm ios:prod:install
```

Both commands run Expo prebuild for the selected flavor, build a
Release iPhoneOS app with `xcodebuild`, and install it on the first
connected trusted iPhone. To target a specific phone:

```sh
IOS_DEVICE_ID=<udid> pnpm ios:dev:install
IOS_DEVICE_ID=<udid> pnpm ios:prod:install
```

## Flavors

| Command                 | Display name      | Bundle id             | API / RP host |
| ----------------------- | ----------------- | --------------------- | ------------- |
| `pnpm ios:dev:install`  | `Vex Development` | `chat.vex.mobile.dev` | `dev.vex.wtf` |
| `pnpm ios:prod:install` | `Vex`             | `chat.vex.mobile`     | `api.vex.wtf` |

The dev lane uses the ice-blue dev icon and writes
`webcredentials:dev.vex.wtf?mode=developer`.

The prod local-install lane uses the production icon, production
bundle id, and production server, but defaults
`VEX_IOS_ASSOCIATED_DOMAIN_MODE=developer` so a development-signed
local install can use passkeys before Apple's associated-domain CDN has
picked up a fresh AASA file. CI/TestFlight/App Store production builds
do not set that override and should use plain
`webcredentials:api.vex.wtf`.

Because `?mode=developer` changes the iOS native configuration, it also
changes Expo's fingerprint runtime. The mobile release workflows publish
a second iOS OTA update for that developer-associated-domain runtime
whenever the normal OTA path runs, so local iOS installs can keep taking
OTA updates after the first native install.

## Useful knobs

```sh
IOS_DEVICE_ID=<udid>                 # choose a phone
IOS_DEVELOPMENT_TEAM=<team-id>       # defaults to UBG5MM55LT
IOS_LAUNCH=1                         # launch after install
IOS_KEEP_FLAVOR_PREBUILD=1           # leave generated ios/ in that flavor
VEX_APP_VERSION=0.1.6                # override the stamped app version
EXPO_PUBLIC_VEX_BUILD_LABEL=0.1.6RC  # override the visible build label
VEX_IOS_ASSOCIATED_DOMAIN_MODE=normal pnpm ios:prod:install
```

If `VEX_APP_VERSION` is unset, the installer uses a `mobile-v*` tag on
the current commit when one exists; otherwise it stamps the next patch
after the latest `mobile-v*` tag. Dev builds show that as
`<version>RC-<hash>`, while prod local installs show
`<version>-<hash>`.

By default the installer restores the generated `ios/` project back to
distribution-normal production settings after dev installs or local
prod installs that used `?mode=developer`. The generated native
project is ignored, but this keeps local state less surprising after
switching between flavors.
