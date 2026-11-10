# StallSignal

Pick the right venue for a weekend popup with a forecast you can check and refundable PayPal preorders that can
prove it wrong.

Live demo: https://stallsignal.midknight-labs.workers.dev (no login)

## Judging criteria at a glance

**In short.** StallSignal is for small makers choosing between popup markets for one weekend. It shows a forecast beside refundable PayPal preorders, so paid demand can change the pick. An AI agent calls tools to plan stock within a budget. Code does all money, totals and stock. When the maker chooses, every preorder at a losing venue is refunded.

**Technological Implementation.** PayPal Orders v2 (create, buyer approval, capture, read, and a test card path), Payments v2 (one refund per captured payment at a losing venue) and verified Webhooks. Every write saves its PayPal-Request-Id before the call. AI: IBM Granite 4.0 H Micro on Workers AI with function calling, for at most four turns. Code does all money, totals and stock. Check it: [src/paypal/client.ts](https://github.com/Midknight56/stallsignal-entry/blob/main/src/paypal/client.ts), [src/engine/preorders.ts](https://github.com/Midknight56/stallsignal-entry/blob/main/src/engine/preorders.ts), [src/engine/webhooks.ts](https://github.com/Midknight56/stallsignal-entry/blob/main/src/engine/webhooks.ts), [src/agent/loop.ts](https://github.com/Midknight56/stallsignal-entry/blob/main/src/agent/loop.ts).

**Design.** A full screen map of downtown Portland, Maine: the forecast on one side, paid preorders on the other, and a line that sweeps between them. On the AG Studio dashboard, pick a venue in any widget and every widget filters to it. Check it: [web/src/components/Grid.tsx](https://github.com/Midknight56/stallsignal-entry/blob/main/web/src/components/Grid.tsx).

**Potential Impact.** For small makers who pay for a popup booth before they know it will sell: $200 to $375 a booth plus a $25 fee that is not refunded (Brick South Spring '26 Maker's Market, Eventeny vendor page). Busy places are not always good places. Sources: [docs/SOURCES.md](https://github.com/Midknight56/stallsignal-entry/blob/main/docs/SOURCES.md).

**Innovation/Idea.** Refundable PayPal preorders test the forecast before the maker commits. "What changes the choice?" says how many more orders would make each other venue the pick, and every preorder at a losing venue is refunded. A forecast alone guesses demand. A refundable preorder measures it before the maker commits stock. Check it: [web/src/components/WhatChanges.tsx](https://github.com/Midknight56/stallsignal-entry/blob/main/web/src/components/WhatChanges.tsx).

**Presentation.** The video runs 2 minutes 53 seconds. Try it at https://stallsignal.midknight-labs.workers.dev with no login, in about two minutes. The Proof page shows six payment guards holding. Video guide: 0:11 the forecast beside paid preorders; 0:30 the agent plans stock within the budget; 0:53 a buyer preorders with a refund promise; 1:25 paid demand changes the pick; 1:40 every losing payment is refunded; 1:49 the proof page runs six guards; 2:03 AG Studio filters every widget.

## For judges

The two minute path, no login needed:

1. Open the map: downtown Portland, Maine, on real streets, with three example venues for one weekend. On first load
   the line in the middle sweeps across by itself. The left side shows the forecast, the right side shows paid
   preorders, and the pick follows the line.
2. The decision, the selected venue and **Preorder at this venue** sit at the top of the panel. Under them: the
   estimated margin difference if you booked on the forecast (an estimate, not money saved). **What changes the
   choice?** says how many more orders would make each other venue the pick. Pick **This campaign only** to leave out
   our recorded example.
3. Move the stock budget to $450 and press **Ask the agent**. You see its pick, its risk level, the facts it used, the
   steps it took and a stock plan that fits the budget. The source line says whether the answer came from the model,
   was saved from a live answer, or came from our code, and why. **View recorded example** shows a dated live answer
   at $900 on its own.
4. Open **Campaign** and press **Create buyer link**. Open the link in a private window, which is a separate buyer.
   Pick a venue that is not the current pick and press **Pay with test card**. It pays with a card number from
   PayPal's published sandbox test list, so no login is needed. Back on Campaign, the buyer's units arrive.
5. On Campaign, choose another venue, press **Close campaign**, then **Confirm close**. Under **Each payment's
   refund**, the buyer's payment gets its own refund id and the outstanding liability reaches $0.00. A pending refund
   is checked with PayPal again while the page is open, and **Check refund status** asks right away.

No second window? Place a preorder yourself on the map at a venue that is not the pick and close with another venue.
**Pay with PayPal sandbox** is there too, for the normal PayPal approval page.

**Receipts** shows our own recorded sandbox campaign from 6 Nov 2026, a full capture and refund at once.

The **Proof** page runs our real payment code in your browser against a pretend PayPal and shows six guards holding
(a lost answer, two closes at once, a payment during a close, a client price, a repeated and a late webhook). Nothing
is sent anywhere.

The **Studio** page is an AG Studio dashboard. Pick a venue in any widget and all of them filter to it. Ask it a
question such as "Show forecasts that overestimated demand", or ask it to "Chart refunds by venue" and a widget appears.

### What is real, what is recorded, what is made up

| Label on screen | What it means |
| --- | --- |
| Real streets | The map: real roads, water and 2024 daytime worker counts for downtown Portland, Maine. |
| Example venue, Synthetic history | The maker, its three venues and its eight past popups are invented by us. Each venue name carries an Example venue tag. |
| Recorded sandbox run | Our own real PayPal sandbox campaign, made through this site, kept so you can see a full capture and refund at once. |
| Live sandbox | Preorders you make now: real PayPal sandbox API calls with test money. |

No politics, no personal data. The app stores no payer names or emails.

## How it works

- **Cloudflare Worker** (TypeScript) serves the API and the web app. **D1** stores sessions, campaigns, preorders,
  every PayPal operation and every webhook event.
- **PayPal sandbox, plain REST.** Orders v2 (create with `intent: CAPTURE`, capture, read; the test card path creates
  and captures in one call with `payment_source.card`), Payments v2 (refund,
  refund read) and Webhooks (signature verified with PayPal before anything changes). Every write carries a
  `PayPal-Request-Id` that is saved before the call goes out. A lost capture answer is read back from PayPal. A lost
  order create is sent again with the same id. Nothing is charged twice. Closing a campaign runs once even if two closes arrive together, and a capture that lands while the
  campaign closes is refunded if its venue lost.
- **Workers AI**, model `@cf/ibm-granite/granite-4.0-h-micro`, with function calling. The model asks for our tools
  (read a venue's evidence, compare the sites, allocate stock) and our code runs them, for at most four model turns.
  Then it returns a venue, a risk level and the fact ids behind its pick, as JSON checked against a schema. Code
  checks the answer (only facts the model read count) and falls back to its own pick when the check fails. Code does
  all money, totals and stock. The panel lists the steps the agent really took.
- **AI budget.** The app reserves 15 neurons in a shared ledger before each model turn (at most four turns) and caps
  itself at 900 neurons a day. Workers AI's free allowance is 10,000 neurons a day per account, so a visitor never
  costs money. When the model is off, the budget is used up, a visitor's runs are used, or an answer fails a check,
  the stock plan comes from code for that visitor's budget and evidence, and the panel says which case it was.
- **AG Grid, AG Charts, AG Studio** for the campaign tables, the scorecard chart and the Studio dashboard. A question
  in Studio can add a chart or a grid widget. The Studio
  page shows AG Studio's trial watermark.

## Run it yourself

Needs Node 20 or later and a Cloudflare account. PayPal sandbox REST app keys from developer.paypal.com.

```bash
npm ci
cp .dev.vars.example .dev.vars   # then fill in PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_WEBHOOK_ID
npx wrangler d1 create stallsignal   # put the id in wrangler.jsonc
npx wrangler d1 migrations apply stallsignal --local
npm run web:build
npx wrangler dev
```

Tests:

```bash
npm test
npm run e2e   # headless, against the PayPal sandbox through wrangler dev
```

`wrangler.jsonc` also binds a shared AI ledger database (`LEDGER`). Create your own D1 database with an
`ai_calls(id INTEGER PRIMARY KEY, app TEXT, day TEXT, neurons REAL, at TEXT)` table and point the binding at it.

## Map data

Map data: U.S. Census Bureau. Roads, water and landmarks: 2025 TIGER/Line Shapefiles, prepared by the U.S. Census Bureau, 2025. Daytime workers: U.S. Census Bureau, "me_wac_S000_JT00_2024," LEHD Origin Destination Employment Statistics, 8.5, https://lehd.ces.census.gov/data/lodes, accessed on November 8, 2026. TIGER/Line is a registered trademark of the U.S. Census Bureau.

## Licence

MIT. See [LICENSE](LICENSE). AG Studio (trial), AG Grid Community, AG Charts Community and the PayPal and Cloudflare services are used
under their own terms.
