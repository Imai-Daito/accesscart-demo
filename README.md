# AccessCart

Conversational coffee shopping with explicit choices and PayPal Sandbox checkout.

[Hosted demo](https://accesscart-lmjn.onrender.com/shop). Demo access and Sandbox buyer credentials are provided privately with reviewer instructions; no API keys are needed to use the hosted app. Use Safari on a Mac for the tested speech and VoiceOver environment.

## What it does

Search eight fictional 250g coffee products, compare two, add the cheaper option, change quantities and switch between beans and ground coffee. Prices and stock come from the server. Nonempty orders have USD5 shipping with no tax or additional fees. A price-changing switch waits for explicit consent. The shopper reviews the cart and approves payment in PayPal Sandbox. There is no real charge or delivery.

OpenAI interprets English into a strict structured intent; application code validates and applies changes. The AI cannot approve payments. The server persists a reviewed order and request identities, then verifies a completed capture and amount before clearing the cart and updating demo stock once. Unknown outcomes keep the same order and block replacement payments.

## Run locally

Requires Node.js 26.9.0 or newer. No third-party dependencies need installing.

1. Copy `.env.example` to `.env.local`.
2. Enter your PayPal Sandbox application Client ID and Client Secret. Use only the Sandbox environment.
3. Enter your OpenAI API key and set `ACCESSCART_AI_ENABLED=true` after reviewing API billing and the application's test limits. Chat Completions requests must be allowed for that key. Keep the other public-deployment settings empty for local use.
4. Run `npm start`.
5. Open http://127.0.0.1:4173/shop in Safari.

With AI disabled, the UI can load but shopping interpretation is unavailable. Copying this source creates a separate installation: it does not restore the hosted demo's cart or payment records. Preserve `.env.local`, `.local/` and same-browser cookies when restarting an existing installation. Do not commit or share those files.

## Tests

Stop any other app server on port 4173, then run `npm test`. The 50 tests use isolated temporary data and mocked APIs; they do not spend AI credits or create PayPal orders. HTTP fixtures share port 4173, so the provided test command uses single-file concurrency.

See [validation and limits](VALIDATION.md) for observed tests and pending evaluation. Automated cases are not a claim of complete screen-reader accessibility.

## Speech, privacy and persistence

Use typed English or explicit Start/Stop listening controls. App read-aloud defaults off and can be stopped or disabled for VoiceOver. Safari may send microphone audio to Apple; the app does not save raw audio. Messages, recent conversation and whitelisted shopping context are sent to OpenAI. Conversation text is held in temporary server memory rather than written to disk; OpenAI's retention policies apply. Payment identifiers and credentials are excluded from AI context.

Cart, inventory, payment recovery records and usage limits are stored privately on the server and linked to browser cookies. Demo inventory is separate for each browser. A successful order decreases stock; Start over resets only demo shopping state when payment is not unresolved, retaining order records and usage limits. This is not a live multi-user store or a refund service.

## Limits and deployment

AI attempts reserve a conservative internal allowance of JPY5, up to JPY1,000 total per installation, with 25 requests/hour and 100 total per browser. These are application limits, not invoiced amounts or provider billing caps. An owner can run `node scripts/ai-control.mjs status`, `pause` or `resume`. Pausing new AI requests leaves existing payment recovery available. Existing ledgers survive restart and take precedence over any initial seed.

See [deployment instructions](DEPLOYMENT.md). Public mode needs HTTPS, a private passphrase, one app process and persistent storage. Earlier `/` and `/voice` pages remain for connection history and payment recovery; their fixed-price new-order endpoint is retired. New checkouts use `/shop`.

## License

MIT, copyright Imai-Daito. This is a prototype; no accessibility certification, live retail integration or comparative effectiveness claim is made.
