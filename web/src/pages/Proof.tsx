import { useEffect, useState } from 'react';
import { runAllProofs, type ProofResult } from '../../../src/proof/runner';

export default function Proof() {
  const [results, setResults] = useState<ProofResult[]>([]);
  const [running, setRunning] = useState(true);

  const execute = async () => {
    setRunning(true);
    try {
      const all = await runAllProofs();
      setResults(all);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    execute();
  }, []);

  return (
    <main className="page narrow proof-page">
      <p className="eyebrow">Browser proof</p>
      <h1>Payment guard proofs</h1>
      <p className="proof-banner">
        These checks run the real payment code in your browser. A local stand in plays PayPal, so nothing is sent
        anywhere.
      </p>

      <div className="proof-actions">
        <button type="button" className="button" onClick={execute} disabled={running}>
          {running ? 'Running…' : 'Run again'}
        </button>
      </div>

      <section className="proof-list" aria-label="Proof scenarios">
        {results.map((r) => (
          <article className="card proof-row" key={r.id}>
            <div className="proof-header">
              <h2>{r.title}</h2>
              <span className={`chip ${r.status === 'Held' ? 'held' : 'failed'}`}>{r.status}</span>
            </div>
            <p className="proof-summary">{r.summary}</p>
            <div className="proof-ids">
              {r.requestId && (
                <span>
                  Request id: <code>{r.requestId}</code>
                </span>
              )}
              {r.orderId && (
                <span>
                  Order id: <code>{r.orderId}</code>
                </span>
              )}
              {r.captureId && (
                <span>
                  Capture id: <code>{r.captureId}</code>
                </span>
              )}
              {r.refundId && (
                <span>
                  Refund id: <code>{r.refundId}</code>
                </span>
              )}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
