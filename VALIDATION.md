# Validation and known limits

## Observed

- All 50 automated tests passed using mocked APIs, covering order verification, duplicates, response loss, restart, budgets, access restrictions, price consent and quantity corrections.
- Separate real USD21 PayPal Sandbox checkouts passed on the public origin in Chrome and Safari. Independent Orders GET checks verified completed orders and single completed captures with the expected USD16 subtotal plus USD5 shipping.
- The owner reported one Safari/VoiceOver keyboard flow without mouse/visual assistance, from shopping to PayPal approval and result reading. Same-order reload preserved payment completion, empty cart and reduced stock.
- An owner cancellation before PayPal approval returned to editing with the cart retained. Independent GET showed no capture.
- The owner reported a permission-denied/unavailable message followed by successful typed cart querying. The exact speech error code was not recorded.
- A public service restart preserved the cart and access session.

Environment: macOS 26.6.2 (25G83), Safari 26.6.2, app read-aloud off for the owner VoiceOver run. Basic speech/read-aloud checks were separate observations.

## Limits

External acquaintance testing is deferred and has no reported results. Full independent three-run acceptance and every failure path with VoiceOver remain incomplete. Mocked failure tests do not establish all deployed-provider behavior. These observations do not establish accessibility certification, comparative speed/workload improvements, effectiveness for blind users or support across all browsers/devices. All coffee data is fictional and all payments are Sandbox only; no real sale, delivery, refund or cross-store capability is provided.

Raw credentials, browser cookies, private order/capture identifiers and account screenshots are deliberately excluded from this source release.
