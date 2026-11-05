# Pharmacy dashboard agent instructions

Read HANDOFF.md first. Preserve existing mobile-first Home layout and never expose customer data, secrets or tokens.

## Requested next frontend feature: NOVA Rx agent progress on Home
- Source: https://raw.githubusercontent.com/elsousypharmacy-create/nova-rx/main/reports/agent-progress.json (public, sanitized, read-only). Fetch asynchronously; do not call Kimi or trigger GitHub Actions just to read progress.
- Render a **compact** Home tile, consistent with existing dark Arabic UI, showing: task title, verified completion percent if numeric, otherwise 'نسبة الإنجاز غير متاحة'; verified items / total when known; latest checkpoint and status; a link to the active GitHub run.
- Percent is derived only from verified weighted checklist items; never use arbitrary CI step percentages. Handle network errors and stale timestamps gracefully. Do not interpret an unknown percent as 0%. Keep the Home clean on iPhone; avoid extra vertical scrolling.
- The NOVA progress file is an initial placeholder until the coding/QA agents publish evidence-based checkpoints. Display the honest unknown state until then.
- Scope is frontend only. Do not edit Google Apps Script server, Cloudflare worker, pharmacy financial metrics, or delivery workflows.
- Add small tests for unknown/0/100/stale/offline states, and verify mobile layout before shipping.

## Universal agent checkpoint rule
For any NOVA Rx work, first read nova-rx/HANDOFF.md and AGENTS.md. At meaningful checkpoints, update nova-rx/HANDOFF.md and reports/agent-progress.json with commit/test evidence. Do not restart Kimi to create checkpoints. No unnecessary agent calls or repeated audits.
