# AccessCart

Conversational coffee shopping with explicit choices and PayPal Sandbox checkout.

## Inspiration

Shopping with a screen reader can involve moving between product descriptions, comparisons and cart controls. AccessCart explores a focused alternative: ask about products, understand a comparison and correct an order within one English conversation. This is a working prototype for a small fictional coffee shop, not a claim that it is already effective for blind shoppers.

## What it does

Search eight fixed products, compare two coffees and say “add two bags of the cheaper one.” Change quantities or switch between whole beans and ground coffee. If a change affects the price, AccessCart explains the new total and any budget overrun, then waits for consent.

Text entry, Safari speech input and optional app read-aloud use the same shopping logic. With app read-aloud off, the owner also tested keyboard navigation and VoiceOver. All bags are 250 grams, shipping is USD5 for a nonempty order, and there are no taxes or additional fees.

The shopper reviews the actual cart and explicitly approves checkout in PayPal Sandbox. The application verifies payment completion on the server before clearing the cart and updating that browser's demo stock. Every payment is a test: no real charge or delivery.

## How we built it

Node.js serves the app with standard-library APIs. OpenAI Chat Completions interprets English requests into a strict structured intent. Program code validates catalog IDs, stock, quantities, prices and confirmation before applying a change. The AI cannot approve a payment.

PayPal Orders v2 is central to checkout. A reviewed order snapshot and request identities are saved before network calls. Capture is checked against the order and exact USD amount using a separate Orders GET. Unknown results retain the original order and block replacement payments. A persistent Render disk keeps recovery records across server restarts; a private passphrase protects the hosted demo.

## Challenges and what we learned

Real keyboard testing exposed two gaps: a browser privacy header prevented native-form login, and punctuation in “Yes, please” was rejected by price-consent validation. We corrected both and added regression checks. We also made explicit consent independent of a contradictory AI action and constrained quantity corrections to the actual cart.

The main lesson was that a plausible AI interpretation is not enough. The application must preserve the user's current order and verify the financial result separately.

## What we verified

All 50 automated tests pass using mock APIs, including uncertain results, duplicate operations, restart recovery, incorrect payment amounts and one-time inventory updates. Separate real USD21 Sandbox checkouts passed on the public demo in Chrome and Safari and were independently checked with PayPal Orders GET.

On macOS 26.6.2 and Safari 26.6.2, the owner reported completing shopping, PayPal approval and result reading with VoiceOver and keyboard without mouse or visual assistance. Same-order reload, cancellation before approval and text fallback after a permission-denied/unavailable message also passed once with the owner.

Independent acceptance trials and external user evaluation are not complete; acquaintance testing is deferred. No accessibility certification, comparative speed improvement, general effectiveness for blind users, live retail integration or refunds are claimed.

## What's next

Run independent user sessions, improve confusing interactions identified in those sessions, and broaden failure-path and speech testing. Keep payment verification and explicit user choices at the center as the prototype evolves.
