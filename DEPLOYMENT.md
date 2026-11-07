# Deploy AccessCart

This repository can be run locally or deployed as one Node web service with a private persistent disk. The supplied Render configuration describes a new installation; it does not move the hosted demo's private records or secrets.

## Configuration

Use Node.js 26.9.0 or newer, build command `node --check checkout-probe/server.mjs`, start command `npm start`, and health check `/healthz`. Render provides `PORT` and `RENDER_EXTERNAL_URL`; the app uses the latter if no explicit `ACCESSCART_ORIGIN` is supplied. A custom origin must be the exact HTTPS origin without a path or trailing slash. The reverse proxy must preserve the external Host header.

Set private environment values for `OPENAI_API_KEY`, `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET` and `ACCESSCART_PASSPHRASE` (at least 16 characters). Enable AI with `ACCESSCART_AI_ENABLED=true`. Do not expose secret values in build commands, logs, browser JavaScript, source control or public reviewer instructions.

Set `ACCESSCART_DATA_DIR=/var/data/accesscart` and attach a persistent disk there. Only files under the mounted path survive deploys/restarts. One process/instance is required: this implementation uses atomic JSON files, not a shared database. Do not scale to multiple writers. Back up recovery data privately before updates; do not publish it.

`ACCESSCART_INITIAL_RESERVED_YEN=0` is appropriate for a separate fresh installation. If migrating an existing installation, carry its existing usage ledger/reservation and records; do not reset its limits by replacing it with this example.

## Payment checks

Use only PayPal Sandbox. Test review, approval, return and reload on the final HTTPS origin. Verify completed order/capture status and exact totals. A browser return alone is not evidence of payment. Do not replace an uncertain order; query the same saved order. Cancellation before approval retires the checkout locally, not as a PayPal refund or a claim to void it.

## Access and cost

The public demo has a passphrase gate and Secure, HttpOnly, SameSite=Lax cookies. Keep actual access credentials in private reviewer instructions. Review provider compute, disk and traffic charges before creating resources. Credits, alerts and internal AI allowances are not hard billing caps. Suspension may leave storage charges; do not delete recovery data merely to stop compute.

## Evaluation record retention

The current build's evaluation cleanup date is 2026-12-22 16:00 UTC (December 23 01:00 JST), based on judging ending December 15 at 08:00 PST plus seven days. The running server checks hourly and on requests. Resolved records may be removed after that date; unresolved/busy orders are preserved for reconciliation. After the deadline, new activity is blocked while existing payment confirmation remains available. If the server is stopped, cleanup waits for a later scheduled/request check after it runs again. Review the dates and policy before reusing this prototype for another event; this is not general-purpose production retention.
