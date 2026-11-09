import type { MapWorld } from '../world';
import { recordingTime } from '../world';
import { time } from '../format';
import Receipt from '../components/Receipt';
export default function Receipts({
  world,
  href = (p: string) => p,
}: {
  world: MapWorld;
  href?: (path: string) => string;
}) {
  const at = recordingTime(world);
  return (
    <main className="page">
      <p className="eyebrow">Recorded sandbox run</p>
      <h1>Recorded sandbox run</h1>
      <p>
        Our own PayPal sandbox campaign from 6 Nov 2026. Your own payments and refunds are on Campaign.{' '}
        <a href={href('/campaign')}>Open Campaign</a>
      </p>
      {!at ? (
        <p>Recorded run not captured yet</p>
      ) : (
        <>
          <p>Recorded sandbox run, captured {time(at)}. Our own sandbox payments. No payer data.</p>
          <div className="receipt-list">
            {world.recorded?.preorders.map((p) => (
              <Receipt key={p.id} preorder={p} campaign={world.recorded ?? undefined} />
            ))}
          </div>
          {world.recorded?.ops && (
            <section>
              <h2>Recorded payment operations</h2>
              {world.recorded.ops.map((o, i) => (
                <article className="card" key={i}>
                  <strong>
                    {o.kind} · {o.status}
                  </strong>
                  <p>Request id: {o.requestId}</p>
                  <p>
                    HTTP: {o.http ?? 'Not yet'}. PayPal id: {o.paypalId ?? 'Not yet'}
                  </p>
                  <p>{time(o.at)}</p>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
