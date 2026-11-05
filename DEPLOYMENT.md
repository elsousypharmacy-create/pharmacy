# Deployment sequence

1. Start from a clean checkout and confirm the original base is `ffdd7c53532c834fef28084ab18bdab57e339ed5`; if `main` has advanced, review conflicts rather than overwriting newer work.
2. Copy the package files into the same relative repository paths. Do not copy `MANIFEST.md`, `DEPLOYMENT.md`, or `TEST_RESULTS.md` into production unless documentation is desired.
3. Run `node tools/build-server.js --check`, all `tools/test-*.js`, syntax checks for the server/Worker/service worker, and `git diff --check`. Do not deploy with failing critical tests.
4. Commit the verified changes on a dedicated development branch, open a pull request, review the complete diff, and merge only after CI passes.
5. GitHub Pages publishes the frontend from `main` after the push; allow several minutes and verify the deployed dashboard and static assets.
6. The documented Apps Script auto-update pulls `server/Code.js` from `main`. Verify that this mechanism actually completed; a GitHub merge alone is not proof of Apps Script deployment. Do not invoke live maintenance operations merely to test an endpoint.
7. Deploy `worker/worker.js` separately through the existing Cloudflare mechanism, then use safe non-destructive checks. Do not change the documented delivery system.
8. Verify dashboard reads, financial fixtures/parity where authenticated access is available, and webhook delivery without sending harmful live operations. Preserve WhatsApp, Telegram, cameras, sales, attendance, and all integrations.
9. Webhook signature enforcement requires provider configuration: `WA_APP_SECRET` and `TELEGRAM_WEBHOOK_SECRET`. Without those provider secrets, compatibility behavior remains permissive. Do not expose, rotate, or replace credentials without owner approval.
10. If a critical regression appears, use the documented safe rollback to `ffdd7c53532c834fef28084ab18bdab57e339ed5`; never delete or reset production data.

Production data, credentials, `.env` files, caches, dependencies, and unrelated projects are intentionally absent from this package.
