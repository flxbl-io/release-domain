# Changelog

## [2.0.0](https://github.com/flxbl-io/release-domains/compare/v1.0.0...v2.0.0) (2026-01-19)


### ⚠ BREAKING CHANGES

* Input changed from domain + release-candidate to release-candidates

### Features

* convert to Node.js with integrated environment locking ([639d334](https://github.com/flxbl-io/release-domains/commit/639d334b8fe6f9a6b60ab3b51316069a725e1d9e))
* rename to release-domains and support multiple release candidates ([8d7708a](https://github.com/flxbl-io/release-domains/commit/8d7708af1adbe2778042a38f32786035df3bc94c))


### Bug Fixes

* add output buffer limits to prevent memory issues ([9a18515](https://github.com/flxbl-io/release-domains/commit/9a1851536164ba3eb55a9ffa88e1a303018b6f89))
* increase lock-timeout default to 120 minutes ([cdc494e](https://github.com/flxbl-io/release-domains/commit/cdc494e735df670f4ae1435000c09d7fb56b822e))
* support exclude-packages and override-packages for single-domain releases ([714d2e0](https://github.com/flxbl-io/release-domains/commit/714d2e0aafe25a836cacb26b91eb027bbc0a530b))

## 1.0.0 (2026-01-12)


### Features

* add exclude-packages and override-packages support to release action ([bc2ce46](https://github.com/flxbl-io/release-domain/commit/bc2ce467d801e0279d3ba26a211ce54e66c79c9b))
* initial release action ([f89170f](https://github.com/flxbl-io/release-domain/commit/f89170f2d34771aa7b69be555bfde52c6659c5c3))


### Bug Fixes

* use correct environment auth command and remove trailing slash from server URL ([f36f5b6](https://github.com/flxbl-io/release-domain/commit/f36f5b6c6cacb6c7e0812ca7429ad7dcdcc98444))
