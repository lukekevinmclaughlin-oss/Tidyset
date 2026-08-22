# Tidyset Direct edition

The App Store edition and website edition are intentionally separate builds.

- `ios/` remains the App Store target and retains StoreKit subscriptions.
- `macos/` is the native website Direct edition: fully unlocked, with no StoreKit dependency or in-app purchase UI.
- The Direct edition uses bundle ID `com.lukemclaughlin.tidyset.direct`.
- `scripts/build-direct.sh` produces a universal Developer ID-signed DMG, submits it to Apple notarization, staples the ticket, checks Gatekeeper, and records a SHA-256 checksum.

An installer must not be published unless every automated gate in the script passes. Run a local build without submitting to Apple with:

```sh
SKIP_NOTARIZATION=1 scripts/build-direct.sh
```

Run the release build with:

```sh
scripts/build-direct.sh
```
