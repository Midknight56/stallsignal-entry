# StallSignal build spec (6 Nov 2026, map revised 8 Nov 2026)

This file freezes the city, the data, the state machines and the API contract.

## The product in one breath

A small maker (Tallow and Tide, a candle maker) must pick which of 3 venues in one city gets a weekend pop-up. A full
screen map compares the venues. The agent reads the evidence, picks a venue and proposes a stock allocation. Buyers place
real PayPal sandbox preorders at the venue they want. Paid preorders can overturn the forecast. When the maker closes
the campaign, every captured preorder at a losing venue is refunded, one refund per payment, and each refund is
tracked to the end. A public scorecard shows where the forecast was wrong. Synthetic history is labelled synthetic on
every screen that shows it. No politics, no demographics, no voter data, no personal data.

## Frozen facts

| Item | Value |
| --- | --- |
| City | Downtown Portland, Maine. Real streets and daytime worker counts for 2024 from `src/data/portland.json`. Maps say `Real streets` and `Example venues`. Revised by job J32 |
| Maker | Tallow and Tide (fictional candle maker), one merchant |
| Pop-up weekend | Sat 19 Dec and Sun 20 Dec 2026 |
| Currency | USD, integer cents in code. Strings `"14.00"` only at the PayPal boundary |
| PayPal | Sandbox only, `https://api-m.sandbox.paypal.com`. Orders v2 `intent: "CAPTURE"`, Payments v2 refunds, Webhooks |
| custom_id | `ss-<campaignId>-<preorderId>` on orders; `ss-<campaignId>-<preorderId>-r` on refunds. Webhooks whose resource custom_id does not start `ss-` are ignored (5 other apps share this sandbox REST app) |
| Worker | name `stallsignal`, account hackathon (`*.midknight-labs.workers.dev`) |
| AI | Workers AI `@cf/ibm-granite/granite-4.0-h-micro` only (its model page shows no planned deprecation, read 6 Nov 2026; `@cf/meta/llama-3.2-3b-instruct` is NOT used: "Planned Deprecation 11/20/2026", before judging). 900 neurons a day for this app, 15 reserved before each call |
| Data labels | `Synthetic history` (past pop-ups and footfall), `Daytime workers, 2024` (real map heat), `Example venues` (the three fictional venues), `Recorded sandbox run` (our own real sandbox receipts, dated), `Live sandbox` (preorders made now) |
| Palette | ink `#12263A`, paper `#F6F1E7`, forecast orange `#E2572B`, paid teal `#1F8A84`, pending mustard `#E0A526`, refund slate `#4B6FA8`, failed red `#B8322A`, ok green `#2F7D4F`, muted `#6B7785`, line `#D8CFBF`. Dark mode: bg `#0E1B29`, surface `#16283A`, text `#EEE7DA`. No purple, no grey UI |
| Signature touch | An awning stripe band (CSS repeating gradient, orange and paper, 6 px) on the top bar and on the edge of every receipt card |
| Type | `system-ui` stack; numbers use `font-variant-numeric: tabular-nums` |

## Venues

| id | name | street (stored as district) | rent per weekend | stock cap (units) | map x,y (viewBox 1000x700) |
| --- | --- | --- | --- | --- | --- |
| `wharf` | Shed 9 at the Wharf | Commercial St | $420 | 220 | 681.3,436.5 |
| `mill` | Millrace Hall | Atlantic St | $260 | 160 | 846.6,97.9 |
| `linden` | Linden Corner Shop | A St | $180 | 110 | 112.7,519.5 |

## Catalog

| id | name | price | unit cost | default mix |
| --- | --- | --- | --- | --- |
| `tin` | Travel tin candle | $14.00 | $4.00 | 0.45 |
| `jar` | Harbour jar candle | $28.00 | $9.00 | 0.35 |
| `trio` | Gift trio | $36.00 | $12.00 | 0.20 |

Quantity per preorder: 1 to 3. Price and amount come only from this table. The client never sends a price.

## Synthetic history (labelled `Synthetic history` everywhere)

Eight past weekend pop-ups by other makers in Portland, Maine, invented by us. The maker and venues are also fictional. File `src/data/history.ts`.

| id | venue | season | footfall | forecast units | actual units | preorder units |
| --- | --- | --- | --- | --- | --- | --- |
| h1 | wharf | summer | 5200 | 190 | 171 | 17 |
| h2 | wharf | autumn | 3900 | 150 | 96 | 11 |
| h3 | wharf | winter | 3100 | 130 | 74 | 8 |
| h4 | mill | autumn | 1900 | 80 | 97 | 14 |
| h5 | mill | winter | 1700 | 72 | 91 | 12 |
| h6 | linden | summer | 1300 | 55 | 49 | 6 |
| h7 | linden | winter | 1000 | 45 | 52 | 7 |
| h8 | mill | summer | 2100 | 88 | 84 | 11 |

Facts the history must show (tests check them): the forecast overestimated the wharf in autumn and winter by 56% and
76% of actual sales (tourist footfall does not buy candles in the cold); the mill was underestimated in autumn and winter (18% and 21% under); preorders
were 86 of 714 units, 12.0% (`PREORDER_SHARE` computed from the table, not typed, about 0.12).

Heat cells: 380 flat top hexes over land, radius 22, loaded from `src/data/portland.json`. Each has real 2024
daytime worker counts (`jobs`) and deterministic `interest` 0..1, normalized with `log1p(jobs) / log1p(maxJobs)`.
Labelled `Daytime workers, 2024`. No random generation. Build notes: `tools/build_city.py`.

## Forecast, blend, allocation (code, deterministic, `src/domain/`)

- `forecastUnits(venue, season="winter")`: footfall for Dec (wharf 3000, mill 1750, linden 1050) times the naive
  conversion every forecast in the history used (`forecast units / footfall`, mean per venue, rounded). Result for
  the default: wharf about 117, mill about 74, linden about 46. The forecast favours the wharf. This is the number the
  old way would trust.
- `expectedMargin(venue, units, stockBudget)`: `sold = min(units, stockUnits(budget, venue))`; `sold x (weighted mean price - weighted mean unit cost) - rent`. In cents. Weighted mean price $23.30, unit cost $7.35 (default mix). Unsold candles are kept stock, not a cost. Defaults: wharf about $1,446, mill $920, linden $554, so the forecast picks the wharf; at a $450 budget (61 units) the mill wins, so the budget slider can change the pick.
- `blendedUnits(venue, paidUnits, paidOrdersTotal)`: `w = min(1, paidOrdersTotal / 10)`;
  `forecast * (1 - w) + (paidUnits / PREORDER_SHARE) * w`. Only `captured` preorders count. `pending`, `checking`,
  `approved`, `refunded` and recorded-but-refunded preorders do not count as paid demand, except that the recorded
  layer counts as evidence of demand (it was really paid, then refunded because its campaign closed) and is labelled.
- `decide(...)`: the venue with the highest blended expected margin. `overturned = decided !== forecastPick`.
- `allocate(venue, stockBudgetCents)`: units per product from the default mix, limited by budget and venue stock cap,
  integer units, never over budget. Stock budget slider: $150 to $1,500 in $50 steps, default $900.
- `scorecard()`: per history row error percent `(forecast - actual) / actual`, sign gives over or under; per venue
  mean absolute error; plus one row per closed campaign: forecast pick, decided venue, paid units per venue,
  `forecastWrong = forecastPick !== decided`.

## Campaigns

- The **recorded campaign** `rec-1`: our own real sandbox preorders, made through the live site by the buyer tool
  (`tools/buyer.mjs`), closed with Millrace Hall chosen, losing captures refunded. Its receipts (order id, capture id,
  refund id, statuses, times; no payer data) are saved to `src/data/recorded.json` by `tools/record_run.mjs` and shown
  read only. Target mix: mill 6 preorders (8 units), wharf 2 (2 units), linden 1 (1 unit). With w = 0.9 this blends to mill about 67 units and wharf about 27, so the recorded evidence alone overturns the forecast, and a visitor's live preorders move the numbers further.
- Every visitor gets **their own campaign** (cookie `ss_sid`, random 128 bit, HttpOnly, SameSite=Lax). It shows the
  recorded layer as evidence (labelled) plus their own live preorders. Only their own live captures can be refunded by
  them. Another session's campaign or preorder id answers 403 `NOT_YOUR_CAMPAIGN`.
- Campaign states: `open` -> `closing` -> `closed`. Close takes `{ venue }` and runs serialized (see Payments).

## Preorder state machine

```
draft -> creating -> created -> approved -> capturing -> captured -> refund_queued -> refunding -> refunded
                 \-> checking                  \-> checking       \-> pending (capture PENDING)   \-> refund_pending
                                               \-> declined                                        \-> refund_failed
creating -> failed (the create request was never sent)
capturing -> failed (only when the capture request was provably never sent)
created/approved -> canceled (buyer cancels, or campaign closed before capture: no PayPal call, the order just expires)
captured at a losing venue after close -> refund_queued (the race case)
card: creating/checking -> captured | pending | declined (create includes capture; no approval or separate capture)
```

`PreorderState = draft | creating | created | approved | capturing | checking | pending | declined | failed | captured | refund_queued | refunding | refunded | refund_pending | refund_failed | canceled`.

`failed` means the payment write never left this app. Its op is `failed` with `http: null`, and the route returns the
preorder with HTTP 200. It contributes no paid demand, pending demand or refund liability and is never refunded.
The buyer sees `PayPal could not be reached. Nothing was charged.` and can create a new preorder with `Try again`.

`checking` means a PayPal write went out and its answer was lost. While any preorder of a campaign is `checking`, the
UI shows `Checking payment`, the pay and close buttons are disabled, and the reconcile step runs (GET the order or
the refund) before anything else. A state never moves backwards: `refunded` is never set back to `captured` by a
late webhook.

## Payments (all in `src/paypal/` and `src/engine/`)

- Token: `POST /v1/oauth2/token`, cached in memory per isolate until 60 s before expiry.
- Every write has a stable `PayPal-Request-Id`, stored in the `ops` row BEFORE the request is sent:
  create `ss-create-<preorderId>`, capture `ss-capture-<preorderId>`, refund `ss-refund-<preorderId>`.
- Create: `POST /v2/checkout/orders`, one purchase unit, `items` with sku and unit_amount, `amount.breakdown.item_total`,
  `custom_id`, `invoice_id = ss-<preorderId>`, `payment_source.paypal.experience_context` with `return_url`
  `<origin>/return?p=<preorderId>`, `cancel_url` `<origin>/return?p=<preorderId>&cancel=1`,
  `shipping_preference: "NO_SHIPPING"`, `user_action: "PAY_NOW"`, `brand_name: "StallSignal demo"`. Returns the
  `payer-action` link; the browser goes there.
- Method defaults to `paypal`. For `card`, use only the fixed server owned sandbox test card (PayPal's published Visa
  list, read 8 Nov 2026); ignore client card data and require `PAYPAL_BASE` exactly `https://api-m.sandbox.paypal.com`.
  Card create includes capture: order `COMPLETED` plus capture `COMPLETED` -> `captured`, `PENDING` -> `pending`,
  `DECLINED` -> `declined`; a non `COMPLETED` order or HTTP 422 decline -> `declined`. Save order and capture ids,
  go straight to the receipt, and use the same close, late capture refund and webhook handlers. Never call capture for card.
- Capture: on return, server checks the campaign is `open` and the preorder is `approved` in one conditional UPDATE
  (`approved -> capturing WHERE campaign state = 'open'`). If the campaign is not open: preorder -> `canceled`, no
  capture. Then `POST /v2/checkout/orders/{id}/capture`. `COMPLETED` -> `captured` with capture id; `PENDING` ->
  `pending`; `422 INSTRUMENT_DECLINED` or `DECLINED` -> `declined` (draft kept, buyer may retry with a new order).
- Lost answer (network error, timeout, 5xx after send): op row -> `lost`, preorder -> `checking`. Reconcile: `GET
  /v2/checkout/orders/{id}`; COMPLETED -> captured; APPROVED -> retry the same capture with the same request id (once,
  within 1 hour); otherwise keep `checking` and show it. Never create a second order automatically.
  A lost create is replayed once within 1 hour using the stored body and request id; its answer settles the preorder,
  including card captures. Keep `checking` if the replay answer is also lost. Never mint another request id.
- After a capture lands, if the campaign is no longer `open` and the venue is not the chosen one -> `refund_queued`.
- Close (serialized): `UPDATE campaigns SET state='closing', close_token=? WHERE id=? AND state='open'`; zero rows ->
  409 `ALREADY_CLOSING`. Then: reconcile every `checking`/`capturing` preorder; cancel `created`/`approved` ones at
  losing venues; queue every `captured` one at a losing venue; send refunds one at a time
  (`POST /v2/payments/captures/{captureId}/refund`, body `{ custom_id, note_to_payer }`, full amount) and read each
  back (`GET /v2/payments/refunds/{id}`); `COMPLETED` -> `refunded`, `PENDING` -> `refund_pending`, error ->
  `refund_failed` (kept as outstanding liability, retry button). Then `state='closed'`. There is no bulk reversal:
  the UI shows each payment's own outcome.
- Refund liability = sum of amounts in `refund_queued`, `refunding`, `refund_pending`, `refund_failed`.
- Webhooks `POST /webhooks/paypal`: read the raw body text; verify with `POST /v1/notifications/verify-webhook-signature`
  (the five `paypal-*` headers, `webhook_id` from env `PAYPAL_WEBHOOK_ID`, `webhook_event` = the parsed body);
  not `SUCCESS` -> 400. Insert `event_id` into `events` (UNIQUE); a repeat -> 200 and no work. Ignore other apps'
  events (custom_id prefix). For capture and refund events, read the current resource from PayPal and apply a forward
  only transition. Unfinished events (status `received`) are picked up again by the next close or reconcile.
- Dev faults, only when env `DEV_ROUTES === "1"` (404 otherwise): `POST /api/dev/fault`
  `{ kind: "lose_next_response" | "capture_pending" | "decline_next_capture" | "decline_next_card" | "refund_pending" | "refund_fails" }`.
  `decline_next_card` sends the real sandbox name trigger `CCREJECT-REFUSED` (`DO_NOT_HONOR`) on the next card create;
  it is saved in the request body before sending and is not a simulated response. PayPal orders do not consume it.
  `lose_next_response`: the next PayPal write IS sent, then its answer is dropped. The remaining capture and refund faults set the sandbox header
  `PayPal-Mock-Response` on the next matching call where PayPal supports it, else fake the answer in our client, and
  the receipt then says `Simulated failure (dev route)`. Production never has `DEV_ROUTES`.

## AI agent (`src/agent/`)

The agent runs a model controlled tool loop (`src/agent/loop.ts`). The offered tools are
`read_location_evidence(venue)` (fact ids and code owned text), `compare_sites()` (blended units and expected
margin per venue), and `propose_stock_allocation(venue, budget)` (allocation rows). The code always uses the
visitor's stock budget, regardless of the model's proposed budget. The offer is still a fixed code template
(`draft_preorder_campaign`), never model text.

At most four calls use `env.AI.run("@cf/ibm-granite/granite-4.0-h-micro", { messages, tools, max_tokens: 160 })`.
Turns 1 to 3 offer function tools (`type: function`). Turn 4, or the first turn after a response with no tool calls, has no
`tools` and instead uses `response_format: { type: "json_schema", json_schema: <pickSchema> }`.
The final answer is `{ "pick": "wharf"|"mill"|"linden", "facts": [...], "risk": "low"|"medium"|"high" }`.
Accept both the chat completion shape `choices[0].message.tool_calls` and binding `tool_calls: [{ name, arguments }]` responses.
Decode string arguments at most twice to obtain an object. The code runs each validated call and appends an
assistant tool call message and a tool result message. It does not trust model supplied text or amounts.

Every serialized request (including message metadata, tools or the final schema) is bounded to 3,400 characters.
Only tool result fact text may be shortened; ids, numbers and system rules stay intact. If metadata cannot fit,
stop without another call. A thrown call, unknown tool, bad arguments, repeated effective call or `length`
finish reason ends the loop with the code answer. A refused reservation also returns the code answer.

Final checks: a listed venue with positive expected margin; 2 to 4 distinct real fact ids; at least one fact about
the pick; every cited fact must have been read through `read_location_evidence` during this run; a valid risk.
Failure uses `Code pick (model answer failed a check)`. The explanation always uses the facts' original code
owned text. The model never supplies a price, amount or identifier used for payments.

`AgentView.steps` records only tools the model requested and code completed, in order, with code owned labels.
A reservation refusal retains completed steps for inspection, as required by J34's fail closed rule; other code
answers and recorded answers have no steps. The panel renders a numbered list only for a live (`ai`) answer. Cached
answers store the steps with `loop: 1`; older entries lose obsolete steps on read. Cache answers show no list.

A test (and a check at Worker start that refuses AI calls) fails if the configured model id is in
`DEPRECATED_MODELS` in `src/caps.ts`, which lists at least `@cf/meta/llama-3.2-3b-instruct` and
`@cf/qwen/qwen3-30b-a3b-fp8` (both "Planned Deprecation 11/20/2026" on Cloudflare's model pages, 6 Nov 2026).

Studio ask (one call): text up to 200 characters -> `{ "view": "overestimated"|"underestimated"|"by_venue"|"refunds_open"|"paid_vs_forecast", "venue": null|"wharf"|"mill"|"linden" }`. Not one of those -> a keyword matcher in code
answers, labelled `Matched without AI`.

Budget, with the $0 sum beside the constant in `src/caps.ts`:
- `APP_NEURONS_PER_DAY = 900`; `ACCOUNT_NEURONS_PER_DAY = 9000` (shared ledger, same as the other hackathon apps;
  free day is 10,000 per account, Cloudflare Workers AI pricing page).
- `RESERVE_PER_CALL = 15`: each turn reserves 15 before calling the model, using the existing shared
  conditional ledger statement that checks both app and account sums. Measured `usage.neurons` settles that turn;
  missing usage or a thrown call retains 15. The ask route retains its single call and existing usage handling.
- At the granite rates recorded above, count one token per input character plus a 64 token template:
  `(3464*1542 + 160*10158)/1e6 = 6.967968 < 15` neurons per turn. At most four reservations total 60 per run.
  The app and account daily caps remain 900 and 9,000. No paid provider or AI gateway is used.
- Missing model/storage or a visitor/app run limit returns `src/data/recorded-agent.json`, labelled
  `Recorded run, captured <date>`. Once a tool loop starts, ledger refusal returns the code answer and completed
  steps without making another model call.
- Cache: answers keyed by a hash of (budget, paid units per venue, recorded flag) for 24 hours in D1.
- Per visitor (hash of IP and user agent): 12 agent runs and 12 asks a day. Whole app: 200 runs a day.

PayPal write caps (sandbox is free, these stop abuse): 10 preorders per session per UTC day, 400 per day app wide.

## API contract (JSON; errors are `{ error: CODE, message }`)

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/world` | | `{ city, venues, catalog, heat, history, recorded, preorderShare, modes }` (static plus recorded receipts) |
| `GET /api/campaign` | | `CampaignView` for this session (creates the session and campaign on first call) |
| `POST /api/agent` | `{ budget }` (cents) | `AgentView` |
| `POST /api/preorders` | `{ venue, product, qty, method?: "card"|"paypal" }` | `{ preorder, approveUrl }` (`approveUrl: null` for card) |
| `POST /api/preorders/:id/return` | `{ cancel?: boolean }` | `{ preorder }` (captures when approved) |
| `POST /api/preorders/:id/reconcile` | | `{ preorder }` |
| `POST /api/campaign/close` | `{ venue }` | `CampaignView` |
| `POST /api/campaign/refunds/:preorderId/retry` | | `CampaignView` |
| `POST /api/campaign/reset` | | new empty `CampaignView` (only when closed) |
| `GET /api/scorecard` | | `{ history: rows, campaigns: rows, perVenue }` (public, all closed campaigns, no session data beyond venue counts) |
| `POST /api/ask` | `{ q }` | `{ view, venue, source: "ai"|"matched"|"recorded" }` |
| `POST /webhooks/paypal` | raw | 200 / 400 |
| `GET /health` | | `{ ok: true }` |

`CampaignView = { id, state, chosen, forecastPick, decided, overturned, venues: [{ id, forecastUnits, recordedUnits, paidUnits, pendingUnits, blendedUnits, marginCents }], preorders: [Preorder], liabilityCents, checking: boolean, ops: [Op] }`

`Preorder = { id, method: "card"|"paypal", venue, product, qty, amountCents, state, orderId, captureId, refundId, debugId, updatedAt, source: "live"|"recorded" }`. Older recorded data without `method` means PayPal and stays unchanged. Campaign rows and receipts label the method `Test card` or `PayPal`. Migration `0003_method.sql` defaults existing rows to `paypal`.

`Op = { kind: "create"|"capture"|"refund"|"read", requestId, status: "sending"|"ok"|"lost"|"failed", http, paypalId, at }`

`AgentView = { pick, codePick, source: "ai"|"code"|"recorded"|"cache", facts: [{ id, text }], risk, allocation: [{ product, units, costCents }], stockCostCents, offer: { venue, lines, terms }, neurons: { reserved, used, appLeft } }`

## Storage

D1 database `stallsignal` (binding `DB`): `sessions`, `campaigns`, `preorders`, `ops`, `events`, `agent_cache`,
`runs`, `asks`, `caps`. Migrations in `migrations/`. Shared ledger D1 `hackathon-ledger` (binding `LEDGER`, id
`023377a8-ad19-413c-b769-d195d05427b3`, `remote: true`). No KV, no Durable Objects (serialization is by conditional
UPDATEs on the campaign row; tests prove two closes run once and a capture during close is refunded).

## Screens (React + Vite, `web/`)

| # | Screen | What it must show |
| --- | --- | --- |
| 1 | Map (home `/`) | Full screen SVG map of Portland, Maine (real water rings, roads, street labels and worker heat cells), 3 example venue pins with forecast and paid rings, a draggable comparison line: left side `Forecast`, right side `Preorders`. Panel: venue cards, the decision line (`Forecast picks Shed 9. Preorders pick Millrace Hall.`), mode chips (`Live AI` or `Recorded run`, `Sandbox`). Phone: panel is a bottom sheet |
| 2 | Agent panel | Stock budget slider, `Ask the agent`, pick, risk, the chosen facts, live tool steps, allocation table, source label, neurons used and left today |
| 3 | Preorder sheet | Venue, product, qty, amount from the catalog, terms `Fully refunded if this venue is not chosen. Pickup Sat 19 Dec.`, `Pay with PayPal sandbox` |
| 4 | Return / receipt | Capturing, then Paid (order id, capture id, amount, time), or Failed, Declined, Canceled, Pending, Checking payment |
| 5 | Campaign `/campaign` | Your preorders, per venue totals, decision, Close with a venue choice, per payment refund outcomes, liability, retry on a failed refund, op log |
| 6 | Scorecard `/scorecard` | Synthetic history forecast vs actual (chart and table), closed campaigns, `Where the forecast was wrong` |
| 7 | Receipts `/receipts` | The recorded run: each preorder's create, capture, refund with PayPal ids, statuses, times |
| 8 | Studio `/studio` | AG Studio dashboard: map widget, evidence grid, forecast error chart, refund liability widget. Selecting a venue in any one filters all four. Ask box (Studio Agent Framework client tool runner, like dispute-desk) |
| 9 | About `/about` | For judges: the 60 second path, what is synthetic, what is live, what is recorded, the AI budget |

Every button: 8 px padding, 16 px from the screen edge, 12 px between neighbours, no overflow at 390x844 and 1280x800.
No horizontal page scroll. Keyboard reachable. `?mock=1` runs the whole UI from fixtures with no `/api` call.

## Tests that must exist (unit, vitest, fake PayPal with injected fetch and clock)

success; decline; canceled approval; lost create answer; lost capture answer (PayPal acted) reconciles to captured with
one capture; duplicate return presses capture once; client sent amount is ignored; cross session access 403; duplicate
webhook; out of order webhook (refunded never goes back to captured); refund pending; refund failed then retry;
partial close (some refunds succeed, one fails) shows per payment outcomes; two closes at once run once; capture that
lands during close is refunded; pending capture does not count as paid demand; recorded layer never counted as live
sales; synthetic history labels present in the world payload; ledger refuses a call over the cap; ledger down fails
closed to the recorded run; model answer with a bad venue or fake fact id falls back to the code pick; caps per session.

E2E (Playwright, headless, real sandbox through `wrangler dev`): happy path with the buyer approval, decline via the
dev route, lost capture via the dev route, close with refunds, phone layout checks, `?mock=1` walk.
