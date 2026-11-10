import { useEffect, useRef, useState } from 'react';
import type { CampaignView, VenueId } from '../../../src/shared/types';
import type { MapWorld } from '../world';
import CityScene from './CityScene';
import { clampSplit, splitFromPointer } from '../layout';

export default function CityMap({
  world,
  campaign,
  selected,
  onSelect,
  split,
  onSplit,
  includeRecorded = true,
}: {
  world: MapWorld;
  campaign: CampaignView;
  selected: VenueId;
  onSelect: (id: VenueId) => void;
  split: number;
  onSplit: (value: number) => void;
  includeRecorded?: boolean;
}) {
  const frame = useRef<number | null>(null);
  const touched = useRef(false);
  const rememberSweep = () => {
    try {
      sessionStorage.setItem('stallsignal.comparisonSeen', '1');
    } catch {
      /* Storage may be blocked. */
    }
  };
  const stopSweep = () => {
    touched.current = true;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    rememberSweep();
  };
  useEffect(() => {
    if (
      touched.current ||
      new URLSearchParams(location.search).get('nosweep') === '1' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    try {
      if (sessionStorage.getItem('stallsignal.comparisonSeen')) return;
    } catch {
      /* Still allow this visit. */
    }
    onSplit(5);
    let start: number | undefined;
    const tick = (now: number) => {
      if (touched.current) return;
      if (start === undefined) {
        start = now;
        rememberSweep();
      }
      const progress = Math.min(1, (now - start) / 2000);
      onSplit(5 + progress * 90);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [onSplit]);
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(root.current!.querySelector('svg')!);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(size.width / 1000, size.height / 700);
  const splitX = ((size.width * split) / 100 - (size.width - 1000 * scale) / 2) / Math.max(0.01, scale);
  return (
    <div ref={root} className="city-map">
      <CityScene
        world={world}
        campaign={campaign}
        selected={selected}
        onSelect={onSelect}
        splitX={splitX}
        includeRecorded={includeRecorded}
      />
      <div className="map-heading">
        <span className="eyebrow">Tallow and Tide • 19 + 20 Dec 2026</span>
        <h1>Where should we set up?</h1>
        <p>
          {world.city.name} <span className="chip">Real streets</span>
        </p>
      </div>
      <div className="compare-line" style={{ left: `${split}%` }}>
        <span className="compare-label forecast-label">Forecast</span>
        <span className="compare-label preorders-label">Preorders</span>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Forecast and preorders comparison"
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(split)}
          aria-orientation="horizontal"
          className="compare-handle"
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              stopSweep();
              onSplit(
                e.key === 'Home'
                  ? 5
                  : e.key === 'End'
                    ? 95
                    : clampSplit(split + (e.key === 'ArrowLeft' ? -2 : 2)),
              );
            }
          }}
          onPointerDown={(e) => {
            stopSweep();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              const r = root.current!.getBoundingClientRect();
              onSplit(splitFromPointer(e.clientX, r.left, r.width));
            }
          }}
        >
          ↔
        </div>
      </div>
      <div className="map-legend">
        <span className="forecast">○ Forecast units</span>
        <span className="paid">○ Paid units</span>
        <span className="paid-demand">
          <span aria-hidden="true">▨ ●</span>{' '}
          {includeRecorded ? 'Paid demand: our recorded run of 6 Nov plus yours.' : 'Paid demand: this campaign only.'}
        </span>
        <span>Heat: daytime workers, 2024</span>
        <span>Forecast history</span>
        <span>Map data: U.S. Census Bureau (TIGER/Line 2025, LODES 8.5).</span>
      </div>
    </div>
  );
}
