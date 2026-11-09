import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AgStudioAiModule,
  AgStudioLicenseManager,
  clientToolRunner,
  createAiHarness,
  type AgAiHarness,
  type AgAiRunInput,
  type AgReportState,
  type AgStudioApi,
} from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { ask, getCampaign, getScorecard, getWorld, isMock } from '../api';
import { errorText } from '../format';
import { useDark } from '../theme';
import { shapeTables, studioData } from './data';
import {
  applySelection,
  initialSelection,
  toggleVenue,
  venueFromCrossFilter,
  type Selection,
} from './filter';
import { createInitialLayout, widgetLayout } from './layout';
import { revealWidget, widgetTitle } from './reveal';
import {
  answerSource,
  answerText,
  askToChange,
  changeEvents,
  addWidgetEvents,
  latestUserText,
  sendQuestion,
  shouldFinish,
  type AskChange,
} from './runner';
import {
  addWidgetTo,
  defaultTitleFor,
  getAddedWidgetIds,
  kindLabel,
  removeAddedWidgetsFrom,
  sanitizeTitle,
} from './addWidget';
import { makeTheme } from './theme';
import { customWidgets, DashboardContext } from './widgets';
import '../app.css';
import './studio.css';

const licenseKey = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY;
if (typeof licenseKey === 'string' && licenseKey.trim()) AgStudioLicenseManager.setLicenseKey(licenseKey);

const prompts = [
  'Show forecasts that overestimated demand',
  'Where are refunds still open?',
  'Chart refunds by venue',
];
const panels = { view: { left: [], right: [] }, edit: { left: [], right: [] } };
const layout = { columns: 12, rowHeight: 8 };
const studioStyle = { width: '100%', height: 'auto' };

function StudioPage() {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof loadSnapshot>> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const selectionRef = useRef(selection);
  const [compact, setCompact] = useState(() => window.innerWidth < 760);
  const compactRef = useRef(compact);
  const apiRef = useRef<AgStudioApi | null>(null);
  const harnessRef = useRef<AgAiHarness | null>(null);
  const [ready, setReady] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState('');
  const [answer, setAnswer] = useState<AskChange | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const lastSourceRef = useRef<'ai' | 'matched' | 'recorded'>('ai');
  const dark = useDark();
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const theme = useMemo(() => makeTheme(dark), [dark]);
  const initialState = useMemo(() => createInitialLayout(compact, dark), []);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      harnessRef.current?.dispose?.();
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await loadSnapshot();
        if (active) {
          setSnapshot(next);
          setLoadError('');
        }
      } catch (error) {
        if (active) setLoadError(errorText(error));
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [attempt]);

  useEffect(() => {
    const media = matchMedia('(max-width: 759px)');
    const resize = () => {
      const narrow = media.matches;
      compactRef.current = narrow;
      setCompact(narrow);
      const api = apiRef.current;
      if (api) {
        const state = api.getState();
        api.setState({
          ...state,
          pages: state.pages.map((p) => ({
            ...p,
            widgetLayout: widgetLayout(
              narrow,
              tablesRef.current?.evidence.length,
              tablesRef.current?.preorders.length,
              p.widgets,
            ),
          })),
        });
      }
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);

  const tables = useMemo(
    () => (snapshot ? shapeTables(snapshot.world, snapshot.campaign, snapshot.scorecard) : null),
    [snapshot],
  );
  const tablesRef = useRef(tables);
  tablesRef.current = tables;
  const data = useMemo(() => (tables ? studioData(tables) : undefined), [tables]);
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !tables) return;
    const state = api.getState();
    api.setState({
      ...state,
      pages: state.pages.map((p) => ({
        ...p,
        widgetLayout: widgetLayout(compact, tables.evidence.length, tables.preorders.length, p.widgets),
      })),
    });
  }, [compact, tables?.evidence.length, tables?.preorders.length]);
  const changeSelection = useCallback((next: Selection) => {
    selectionRef.current = next;
    setSelection(next);
    const api = apiRef.current;
    if (api) api.setState(applySelection(api.getState(), next, darkRef.current));
  }, []);
  useEffect(() => {
    if (apiRef.current) changeSelection(selectionRef.current);
  }, [dark, changeSelection]);
  const selectVenue = useCallback(
    (venue: Parameters<typeof toggleVenue>[1]) => changeSelection(toggleVenue(selectionRef.current, venue)),
    [changeSelection],
  );
  const setup = useCallback(
    ({ api }: { api: AgStudioApi }) => {
      const harness = createAiHarness(api, () => ({
        primary: 'studio',
        agents: [
          clientToolRunner({
            id: 'studio',
            description: 'Changes the dashboard from a request.',
            schema: (s) => s.undefined(),
            maxTurns: 3,
            tools: () => [
              api.defineAiTool({
                name: 'set_dashboard_view',
                description: 'Apply a checked venue and dashboard view.',
                params: (s) =>
                  s.object({
                    view: s.enum([
                      'overestimated',
                      'underestimated',
                      'by_venue',
                      'refunds_open',
                      'paid_vs_forecast',
                    ] as const),
                    venue: s.union([s.enum(['wharf', 'mill', 'linden'] as const), s.null()]),
                    source: s.enum(['ai', 'matched', 'recorded'] as const),
                  }),
                execute: async (args, ctx) => {
                  const checked = askToChange(args);
                  if (!checked) return ctx.error('The answer did not match a supported view.');
                  if (!alive.current || ctx.signal?.aborted) return ctx.error('Request canceled.');
                  changeSelection(checked);
                  setAnswer(checked);
                  return ctx.success(answerText(checked));
                },
              }),
              api.defineAiTool({
                name: 'add_widget',
                description: 'Add a chart or table widget to the dashboard.',
                params: (s) =>
                  s.object({
                    kind: s.enum([
                      'refunds_by_venue',
                      'paid_by_venue',
                      'preorders_by_state',
                      'pending_payments',
                    ] as const),
                    title: s.string(),
                  }),
                execute: async (args, ctx) => {
                  if (!alive.current || ctx.signal?.aborted) return ctx.error('Request canceled.');
                  const title = sanitizeTitle(args.title);
                  const ok = addWidgetTo(api, args.kind, title, darkRef.current, compactRef.current);
                  if (!ok) return ctx.error('The widget could not be added.');
                  const page = api.getState().pages.find((p) => p.id === api.getState().selectedPageId);
                  setAddedCount(getAddedWidgetIds(page ?? {}).length);
                  const answerObj: AskChange = {
                    view: selectionRef.current.view,
                    venue: selectionRef.current.venue,
                    source: lastSourceRef.current,
                    add: args.kind,
                    title,
                  };
                  setAnswer(answerObj);
                  revealWidget(() => widgetTitle(title), (next) => requestAnimationFrame(next));
                  return ctx.success(`Added a ${kindLabel(args.kind)}.`);
                },
              }),
            ],
            run: async function* (input: AgAiRunInput, ctx) {
              if (ctx.signal?.aborted) return;
              if (shouldFinish(input)) return;
              try {
                const q = latestUserText(input);
                if (!q) {
                  yield { type: 'RUN_ERROR', message: 'Enter a question first.' };
                  return;
                }
                const raw = await ask(q);
                const result = askToChange(raw);
                if (ctx.signal?.aborted) return;
                if (!result) {
                  yield { type: 'RUN_ERROR', message: 'The answer did not match a supported view.' };
                  return;
                }
                lastSourceRef.current = result.source;
                if (result.add) {
                  const title = result.title ?? defaultTitleFor(result.add);
                  yield* addWidgetEvents(result.add, title, input.runId);
                } else {
                  yield* changeEvents(result, input.runId);
                }
              } catch (error) {
                if (!ctx.signal?.aborted) yield { type: 'RUN_ERROR', message: errorText(error) };
              }
            },
          }),
        ],
        promptStarters: prompts.map((prompt) => ({ label: prompt, prompt })),
      }));
      harnessRef.current = harness;
      return harness;
    },
    [changeSelection],
  );

  const submit = async (text: string) => {
    const q = text.trim();
    if (!q || q.length > 200 || busy || !ready) return;
    setBusy(true);
    setAskError('');
    setAnswer(null);
    try {
      const harness = harnessRef.current;
      if (!harness) throw new Error('NETWORK');
      const session = await harness.createThread({ agentId: 'studio' });
      try {
        await sendQuestion(session, q);
      } finally {
        await harness.deleteThread(session.threadId);
      }
    } catch (error) {
      if (alive.current)
        setAskError(
          error instanceof Error && !/^[A-Z_]+$/.test(error.message) ? error.message : errorText(error),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const href = (path: string) => `${path}${isMock() ? '?mock=1' : ''}`;
  return (
    <AgStudioProvider modules={[AgStudioAiModule]}>
      <a className="skip" href="#studio-content">
        Skip to Studio
      </a>
      <header className="topbar">
        <a className="brand" href={href('/')}>
          StallSignal<span className="brand-dot">●</span>
        </a>
        <nav aria-label="Main navigation">
          <a href={href('/')}>Map</a>
          <a href={href('/campaign')}>Campaign</a>
          <a href={href('/scorecard')}>Scorecard</a>
          <a href={href('/receipts')}>Receipts</a>
          <a href={href('/studio')} aria-current="page">
            Studio
          </a>
          <a href={href('/about')}>About</a>
        </nav>
        {isMock() && <div className="modes">Preview data</div>}
      </header>
      <main id="studio-content" className="studio-shell">
        <section className="studio-intro">
          <div>
            <span className="eyebrow">Tallow and Tide · Portland, Maine</span>
            <h1>Evidence Studio</h1>
          </div>
          <p>Select a venue in any widget to connect the evidence.</p>
        </section>
        <section className="studio-ask" aria-label="Ask about the dashboard">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(question);
            }}
          >
            <label htmlFor="studio-question">Ask about this evidence</label>
            <div className="studio-ask-line">
              <input
                id="studio-question"
                maxLength={200}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="For example, chart refunds by venue"
              />
              <button type="submit" className="primary" disabled={busy || !ready || !question.trim()}>
                {busy ? 'Checking evidence…' : 'Ask'}
              </button>
            </div>
          </form>
          <div className="studio-prompts">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                disabled={busy || !ready}
                onClick={() => {
                  setQuestion(prompt);
                  void submit(prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
          <div className="studio-answer" aria-live="polite">
            {answer && (
              <>
                <p>{answerText(answer)}</p>
                <p className="source">{answerSource(answer.source)}</p>
              </>
            )}
            {askError && (
              <p role="alert" className="error">
                {askError}
              </p>
            )}
          </div>
        </section>
        <div className="studio-selection">
          <p>
            {selection.venue
              ? `Selected: ${snapshot?.world.venues.find((v) => v.id === selection.venue)?.name}`
              : 'All venues'}
            <span className="small">
              {' '}
              ·{' '}
              {
                {
                  by_venue: 'All evidence',
                  overestimated: 'Overestimated forecasts',
                  underestimated: 'Underestimated forecasts',
                  refunds_open: 'Open refunds',
                  paid_vs_forecast: 'Paid and forecast',
                }[selection.view]
              }
            </span>
          </p>
          <div className="studio-selection-actions">
            <button
              onClick={() => {
                changeSelection(initialSelection);
                setAnswer(null);
                setAskError('');
              }}
              disabled={!selection.venue && selection.view === 'by_venue'}
            >
              Clear filters
            </button>
            <button
              className="remove-added"
              onClick={() => {
                const api = apiRef.current;
                if (api) {
                  removeAddedWidgetsFrom(api);
                  setAddedCount(0);
                }
              }}
              disabled={addedCount === 0}
            >
              Remove added
            </button>
          </div>
        </div>
        {loadError && (
          <p role="alert" className="studio-load-error">
            {snapshot && 'Not updated. Showing the last good data. '}
            {loadError} <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </p>
        )}
        {!snapshot && !loadError && (
          <p role="status">
            Loading downtown Portland, Maine. Real streets and daytime workers from 2024. Example venues and
            synthetic history…
          </p>
        )}
        {snapshot && tables && (
          <DashboardContext.Provider
            value={{ world: snapshot.world, campaign: snapshot.campaign, tables, selection, selectVenue }}
          >
            <div className={`studio-canvas ${compact ? 'compact' : ''}`}>
              <AgStudio
                style={studioStyle}
                data={data}
                widgets={customWidgets}
                initialState={initialState as unknown as AgReportState}
                theme={theme}
                layout={layout}
                panels={panels}
                mode="view"
                onApiReady={(event) => {
                  apiRef.current = event.api;
                  setup({ api: event.api });
                }}
                onStudioReady={() => {
                  setReady(true);
                  const api = apiRef.current;
                  if (api) {
                    const state = api.getState();
                    api.setState({
                      ...state,
                      pages: state.pages.map((p) => ({
                        ...p,
                        widgetLayout: widgetLayout(
                          compactRef.current,
                          tablesRef.current?.evidence.length,
                          tablesRef.current?.preorders.length,
                          p.widgets,
                        ),
                      })),
                    });
                  }
                }}
                onStateUpdated={() => {
                  const api = apiRef.current;
                  if (!api || !tablesRef.current) return;
                  const venue = venueFromCrossFilter(api.getState(), tablesRef.current);
                  if (venue !== undefined)
                    changeSelection(
                      venue
                        ? toggleVenue(selectionRef.current, venue)
                        : { ...selectionRef.current, venue: null },
                    );
                }}
              />
            </div>
          </DashboardContext.Provider>
        )}
      </main>
    </AgStudioProvider>
  );
}
async function loadSnapshot() {
  const [world, campaign, scorecard] = await Promise.all([getWorld(), getCampaign(), getScorecard()]);
  return { world, campaign, scorecard };
}
createRoot(document.getElementById('root')!).render(<StudioPage />);
