# Changelog

## 1.1.29 - 2026-04-06

### Improved
- Clarified TokenHub CLI help so API key creation and account commands are easier to discover.
- Tightened English terminology across README, quick-start guides, and SKILL references.
- Standardized the distinction between DID-signed platform requests and TokenHub API-key requests.
- Updated swap guidance to describe `pending_verification` precisely.

### Fixed
- `atel key create` now falls back to DID-signed bootstrap when a saved hub API key is invalid or revoked.
- `atel hub swap` now reports `pending_verification` as a submitted settlement state instead of implying final success.
