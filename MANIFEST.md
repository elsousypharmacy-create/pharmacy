# Elsousy Pharmacy Remediation Package

- Original base commit: `ffdd7c53532c834fef28084ab18bdab57e339ed5`
- Complete tested local revision: `00076c6`
- Remote Worker-only commit `aa371b08d0a542e1839487e3cee21ef4ea901f6e` is **not** the basis of this package.
- All paths below are relative to the repository root.

## Changed files

- `.github/workflows/test.yml`
- `index.html`
- `server/Code.js` (generated; required)
- `server/src/05_routing.js`
- `server/src/23_ai.js`
- `server/src/61_finance.js`
- `server/src/65_raw_days.js`
- `server/src/66_cameras.js`
- `server/src/82_snapshot_staffhub.js`
- `sw.js`
- `tools/build-home-viewport-fixture.py`
- `tools/fixtures/home-legacy.css`
- `tools/fixtures/home-viewport.html`
- `tools/test-audit-remediation.js`
- `tools/test-camera-assessment.js`
- `tools/test-home-expense-loading.js`
- `tools/test-mobile-shell.js`
- `tools/test-period-trend.js`
- `tools/test-staff-cards.js`
- `tools/test-team-customer-metrics.js`
- `worker/worker.js`

## Transfer instructions

Apply these files over a clean checkout of the original base commit, or compare carefully if the target branch has advanced. Do not use the remote branch containing only the Worker commit as a substitute for this package. Run the checks in `TEST_RESULTS.md`, review the diff, then commit in logical batches before merging and deploying.
