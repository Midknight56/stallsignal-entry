import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CampaignView, VenueId } from '../../src/shared/types';
import type { MapWorld } from './world';
import { getCampaign, getWorld, isMock } from './api';
import { errorText } from './format';
import CityMap from './map/CityMap';
import Panel from './panel';
import './app.css';
import { rememberAgentSource, type AgentSource } from './agentStatus';
import { shouldPoll } from './refreshRule';
import { DEFAULT_CONTEXT, type DecisionContext } from '../../src/domain/context';
const Campaign = lazy(() => import('./pages/Campaign'));
const Scorecard = lazy(() => import('./pages/Scorecard'));
const Receipts = lazy(() => import('./pages/Receipts'));
const Proof = lazy(() => import('./pages/Proof'));
const About = lazy(() => import('./pages/About'));
const Return = lazy(() => import('./pages/Return'));
const BuyerCampaign = lazy(() => import('./pages/BuyerCampaign'));
export default function App() {
  // One decision context for every screen: map, panel, agent, campaign and scorecard.
  const [context, setContext] = useState<DecisionContext>(DEFAULT_CONTEXT);
  const [split, setSplit] = useState(50);
  const refreshInFlight = useRef(false);
  const onAgentAnswer = (source: AgentSource) => {
    rememberAgentSource(source);
  };
  const [path, setPath] = useState(location.pathname),
    [world, setWorld] = useState<MapWorld | null>(null),
    [campaign, setCampaign] = useState<CampaignView | null>(null),
    [selected, setSelected] = useState<VenueId>('wharf'),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const href = useCallback((p: string) => `${p}${isMock() ? '?mock=1' : ''}`, []);
  const refresh = useCallback(async () => {
    setCampaign(await getCampaign());
  }, []);
  useEffect(() => {
    if (path.startsWith('/c/')) return;
    let active = true;
    Promise.all([getWorld(), getCampaign()])
      .then(([w, c]) => {
        if (active) {
          setWorld(w);
          setCampaign(c);
          setSelected(c.decided);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [attempt, path]);
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!shouldPoll(campaign)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !refreshInFlight.current) {
        refreshInFlight.current = true;
        refresh()
          .catch(() => {})
          .finally(() => {
            refreshInFlight.current = false;
          });
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [campaign, refresh]);
  useEffect(() => {
    const listener = () => {
      refresh().catch(() => {});
    };
    window.addEventListener('focus', listener);
    return () => window.removeEventListener('focus', listener);
  }, [refresh]);
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="topbar">
        <a
          className="brand"
          href={href('/')}
          onClick={(e) => {
            e.preventDefault();
            history.pushState(null, '', href('/'));
            setPath('/');
          }}
        >
          StallSignal<span className="brand-dot">●</span>
        </a>
        <nav aria-label="Main navigation">
          {[
            ['/', 'Map'],
            ['/campaign', 'Campaign'],
            ['/scorecard', 'Scorecard'],
            ['/receipts', 'Receipts'],
            ['/proof', 'Proof'],
            ['/studio', 'Studio'],
            ['/about', 'About'],
          ].map(([p, label]) => (
            <a
              key={p}
              href={href(p)}
              aria-current={path === p ? 'page' : undefined}
              onClick={(e) => {
                if (p === '/studio') return;
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                history.pushState(null, '', href(p));
                setPath(p);
                window.scrollTo(0, 0);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        {isMock() && <div className="modes">Preview data</div>}
      </header>
      <div id="content" tabIndex={-1}>
        {path.startsWith('/c/') ? (
          <Suspense
            fallback={
              <main className="page" role="status">
                Loading screen…
              </main>
            }
          >
            <BuyerCampaign token={path.replace(/^\/c\//, '').split('/')[0].split('?')[0]} />
          </Suspense>
        ) : error ? (
          <main className="page">
            <h1>We could not load the app</h1>
            <p role="alert">{error}</p>
            <button onClick={() => setAttempt(attempt + 1)}>Try again</button>
          </main>
        ) : !world || !campaign ? (
          <main className="page" role="status">
            Loading downtown Portland, Maine. Real streets and daytime workers from 2024. Example venues and
            synthetic history…
          </main>
        ) : (
          <Suspense
            fallback={
              <main className="page" role="status">
                Loading screen…
              </main>
            }
          >
            {path === '/' ? (
              <main className="home">
                <CityMap
                  world={world}
                  campaign={campaign}
                  selected={selected}
                  onSelect={setSelected}
                  split={split}
                  onSplit={setSplit}
                  includeRecorded={context.includeRecorded}
                />
                <Panel
                  split={split}
                  onAgentAnswer={onAgentAnswer}
                  world={world}
                  campaign={campaign}
                  selected={selected}
                  onSelect={setSelected}
                  onRefresh={refresh}
                  context={context}
                  onContext={setContext}
                />
              </main>
            ) : path === '/campaign' ? (
              <Campaign world={world} campaign={campaign} onChange={setCampaign} context={context} />
            ) : path === '/scorecard' ? (
              <Scorecard world={world} campaign={campaign} context={context} />
            ) : path === '/receipts' ? (
              <Receipts world={world} href={href} />
            ) : path === '/proof' ? (
              <Proof />
            ) : path === '/about' ? (
              <About href={href} />
            ) : path === '/return' ? (
              <Return key={location.search} href={href} onUpdate={refresh} campaign={campaign} />
            ) : (
              <main className="page">
                <h1>Page not found</h1>
                <a href={href('/')}>Return to the map</a>
              </main>
            )}
          </Suspense>
        )}
      </div>
    </>
  );
}
