import { useRef, useState } from 'react';
import { DEFAULT_CONTEXT, type DecisionContext } from '../../../src/domain/context';
import { contextKey, currentAnswer, type StoredAnswer } from '../agentFresh';
import type { AgentView, World } from '../../../src/shared/types';
import { getRecordedAgent, runAgent } from '../api';
import { errorText, money, sourceLabel, venueName } from '../format';
import { recordingTime, type MapWorld } from '../world';
export function AgentSteps({ answer }: { answer: AgentView }) {
  return (answer.source === 'ai' || answer.source === 'cache') && answer.steps?.length ? (
    <section className="agent-steps" aria-label="Agent steps">
      <h4>Steps it took</h4>
      <ol>
        {answer.steps.map((step, i) => (
          <li key={i}>{step.label}</li>
        ))}
      </ol>
    </section>
  ) : null;
}
export default function AgentPanel({
  world,
  budget,
  onBudget,
  evidenceKey,
  onAnswer,
  initialResult,
  context,
  onContext,
}: {
  world: World;
  budget?: number;
  onBudget?: (b: number) => void;
  evidenceKey?: string | number;
  onAnswer?: (source: AgentView['source']) => void;
  initialResult?: AgentView | null;
  context?: DecisionContext;
  onContext?: (c: DecisionContext) => void;
}) {
  const [localBudget, setLocalBudget] = useState(90000);
  // The shared context when the map gives one; otherwise this panel's own budget with the default evidence.
  const ctx: DecisionContext = context ?? { ...DEFAULT_CONTEXT, budget: budget ?? localBudget };
  const currentBudget = ctx.budget;
  const key = contextKey(ctx, evidenceKey ?? '');
  const latestKey = useRef(key);
  latestKey.current = key;
  const [stored, setStored] = useState<StoredAnswer | null>(initialResult ? { key, answer: initialResult } : null);
  // Shown only while the budget, evidence choice, share and payments match the ones it was asked with.
  const result = currentAnswer(stored, key);
  const [recordedExample, setRecordedExample] = useState<AgentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [exampleBusy, setExampleBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  function handleBudgetChange(val: number) {
    if (context && onContext) onContext({ ...context, budget: val });
    else onBudget?.(val);
    setLocalBudget(val);
    setNote('');
  }

  async function run() {
    const sentKey = key;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const answer = await runAgent(ctx);
      // An answer for an older budget or evidence is dropped, never shown beside the new numbers.
      if (latestKey.current !== sentKey) {
        setNote('The budget or evidence changed while the agent was working. Ask again.');
        return;
      }
      setStored({ key: sentKey, answer });
      onAnswer?.(answer.source);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const recordedDate = recordedExample?.capturedAt
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(recordedExample.capturedAt),
      )
    : '6 Nov 2026';
  const recordedBudget = recordedExample?.budgetCents
    ? money(recordedExample.budgetCents).replace(/\.00$/, '')
    : '$900';

  return (
    <section className="agent-panel">
      <p className="eyebrow">A plan from the evidence</p>
      <h2>Ask the agent</h2>
      <label htmlFor="budget">
        Stock budget <strong>{money(currentBudget)}</strong>
      </label>
      <input
        id="budget"
        type="range"
        min="15000"
        max="150000"
        step="5000"
        value={currentBudget}
        onChange={(e) => handleBudgetChange(Number(e.target.value))}
      />
      <div className="range-labels">
        <span>$150</span>
        <span>$1,500</span>
      </div>
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? 'Reading the evidence…' : 'Ask the agent'}
      </button>
      <button
        type="button"
        className="button small recorded-example"
        disabled={exampleBusy}
        onClick={async () => {
          setExampleBusy(true);
          try {
            const rec = await getRecordedAgent();
            setRecordedExample(rec);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setExampleBusy(false);
          }
        }}
      >
        View recorded run
      </button>
      {note && (
        <p role="status" className="small agent-note">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {recordedExample && (
        <div className="recorded-example" aria-label="Recorded agent run">
          <h3>{`Recorded run, ${recordedBudget} budget, ${recordedDate}`}</h3>
          <table>
            <caption>Stock allocation</caption>
            <thead>
              <tr>
                <th>Product</th>
                <th>Units</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {recordedExample.allocation.map((a) => (
                <tr key={a.product}>
                  <td>{world.catalog.find((p) => p.id === a.product)?.name}</td>
                  <td>{a.units}</td>
                  <td>{money(a.costCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td>{recordedExample.allocation.reduce((s, a) => s + a.units, 0)}</td>
                <td>{money(recordedExample.stockCostCents)}</td>
              </tr>
            </tfoot>
          </table>
          {recordedExample.budgetCents !== undefined &&
            recordedExample.stockCostCents <= recordedExample.budgetCents && (
              <p>Within your {money(recordedExample.budgetCents)} budget</p>
            )}
        </div>
      )}
      {result && (
        <div aria-live="polite">
          <h3>{venueName(world.venues, result.pick)}</h3>
          <span className="chip">{result.risk} risk</span>
          {result.codePick !== result.pick && (
            <p className="small agent-disagree">
              The panel's numbers pick {venueName(world.venues, result.codePick)}. The agent chose differently from
              the same facts.
            </p>
          )}
          <p className="source">
            {sourceLabel(result.source, result.capturedAt, result.fallback)}
            {result.source === 'recorded' &&
              (recordingTime(world as MapWorld)
                ? `, captured ${recordingTime(world as MapWorld)}`
                : '. Capture date not supplied.')}
          </p>
          <ul>
            {result.facts.map((f) => (
              <li key={f.id}>{f.text}</li>
            ))}
          </ul>
          <AgentSteps answer={result} />
          <table>
            <caption>Stock allocation</caption>
            <thead>
              <tr>
                <th>Product</th>
                <th>Units</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {result.allocation.map((a) => (
                <tr key={a.product}>
                  <td>{world.catalog.find((p) => p.id === a.product)?.name}</td>
                  <td>{a.units}</td>
                  <td>{money(a.costCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td>{result.allocation.reduce((s, a) => s + a.units, 0)}</td>
                <td>{money(result.stockCostCents)}</td>
              </tr>
            </tfoot>
          </table>
          {result.budgetCents !== undefined && result.stockCostCents <= result.budgetCents && (
            <p>Within your {money(result.budgetCents)} budget</p>
          )}
          <p>{result.offer.lines.join(' ')}</p>
          <p>{result.offer.terms}</p>
          <p className="small">
            Neurons used: {Math.round(result.neurons.used)}. Reserved: {Math.round(result.neurons.reserved)}. Left today:{' '}
            {Math.round(result.neurons.appLeft)}.
          </p>
        </div>
      )}
    </section>
  );
}
