import { MAX_TURNS, RESERVE_PER_CALL } from '../../../src/caps';

export default function About({ href }: { href: (path: string) => string }) {
  return (
    <main className="page narrow">
      <p className="eyebrow">A small maker. A better choice.</p>
      <h1>StallSignal in 60 seconds</h1>
      <p>
        Downtown Portland, Maine is real. The map shows real streets and real daytime worker counts for 2024.
        Tallow and Tide, its three venues and the eight past weekends are made up.
      </p>
      <ol className="judge-path">
        <li>
          <a href={href('/')}>Compare the map.</a> Move the line between forecast and paid preorders.
        </li>
        <li>
          <a href={href('/')}>Ask the agent.</a> Change the stock budget and read the facts behind its choice.
        </li>
        <li>
          <a href={href('/campaign')}>Try a sandbox preorder.</a> Return to the map, choose a venue, then
          close the campaign. Each losing payment gets its own refund.
        </li>
        <li>
          <a href={href('/scorecard')}>Check the scorecard.</a> See what paid demand changed, then{' '}
          <a href={href('/receipts')}>inspect recorded receipts</a>.
        </li>
        <li>
          <a href={href('/proof')}>See the guards.</a> Six payment checks run in your browser against a
          pretend PayPal.
        </li>
      </ol>
      <div className="data-boxes">
        <section className="card">
          <h2>Synthetic</h2>
          <p>
            The eight past weekends, sales and footfall are invented. They show forecast error on synthetic
            history. The map heat shows real daytime workers in 2024. No demographics or personal data.
          </p>
        </section>
        <section className="card">
          <h2>Recorded sandbox run</h2>
          <p>
            Our own real sandbox orders, captures and refunds, dated when captured. They are read only
            evidence. They are never your live sales.
          </p>
        </section>
        <section className="card">
          <h2>Live sandbox</h2>
          <p>
            Your session has its own campaign. PayPal sandbox preorders move its demand. Only your own losing
            captures can be refunded when you close. No real money moves.
          </p>
        </section>
      </div>
      <h2>The AI budget</h2>
      <p>
        The code reserves {RESERVE_PER_CALL} neurons per model turn and allows at most {MAX_TURNS} turns, with
        a cap of 900 neurons a day for this app and 9,000 across the shared account. Numbers, prices, choices
        and stock limits come from code. If the model is off, today's budget is used up, or its answer fails a
        check, the plan comes from code and the panel says so. Each visitor has 12 agent runs and 12 asks a day.
        The app allows 200 runs a day. There is no paid fallback.
      </p>
    </main>
  );
}
