import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { CampaignView, HeatCell, VenueId } from '../../../src/shared/types';
import type { MapWorld } from '../world';

// Paid demand drawn on the map: this campaign's units, plus the recorded example only when it is included.
export const ringTotal = (
  v: { recordedUnits: number; paidUnits: number },
  hasRecording: boolean,
  includeRecorded: boolean,
) => (hasRecording && includeRecorded ? v.recordedUnits : 0) + v.paidUnits;
export default function CityScene({
  world,
  campaign,
  selected,
  onSelect,
  splitX,
  pinLabelSuffix = '',
  interactivePins = false,
  includeRecorded = true,
}: {
  world: MapWorld;
  campaign: Pick<CampaignView, 'venues' | 'preorders'>;
  selected: VenueId | null;
  onSelect: (id: VenueId) => void;
  includeRecorded?: boolean;
  splitX?: number;
  pinLabelSuffix?: string;
  interactivePins?: boolean;
}) {
  const scope = useId().replaceAll(':', '');
  const [activeCell, setActiveCell] = useState<HeatCell | null>(null);
  const geometry = world.city;
  const svg = useRef<SVGSVGElement>(null);
  const [labelSize, setLabelSize] = useState(12);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(entry.contentRect.width / 1000, entry.contentRect.height / 700);
      setLabelSize(Math.max(12, 10 / Math.max(scale, 0.01)));
    });
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const phoneStreets = geometry.labels.filter((label) => label.kind === 'street').slice(0, 4);
  const points = (vertices: number[][]) => vertices.map((p) => p.join(',')).join(' ');
  const waterPath = geometry.water
    .flatMap((feature) => feature.rings)
    .map((ring) => `M${ring.map((p) => p.join(',')).join(' L')}Z`)
    .join(' ');
  const workerText = (cell: HeatCell) => `About ${cell.jobs.toLocaleString('en-US')} daytime workers here`;
  const preorderDots = world.venues.flatMap((v) => {
    const recorded = world.recorded?.recordedAt
      ? world.recorded.preorders.filter((p) => p.venue === v.id)
      : [];
    const live = campaign.preorders.filter((p) => p.venue === v.id && p.state === 'captured');
    return [...recorded, ...live].map((p, i) => (
      <circle
        key={p.id}
        cx={v.x + Math.cos(i * 2.4) * (38 + Math.sqrt(i) * 9)}
        cy={v.y + Math.sin(i * 2.4) * (38 + Math.sqrt(i) * 9)}
        r="3.5"
        fill={p.source === 'recorded' ? `url(#${scope}-paid-hatch)` : 'var(--paid)'}
        stroke="var(--paid)"
      >
        <title>{p.source === 'recorded' ? 'Recorded preorder' : 'Your paid preorder'}</title>
      </circle>
    ));
  });
  return (
    <svg
      ref={svg}
      style={{ '--phone-label-size': `${labelSize}px` } as CSSProperties}
      viewBox={geometry.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role={interactivePins ? 'group' : 'img'}
      aria-labelledby={`${scope}-map-title`}
      aria-describedby={`${scope}-map-desc`}
    >
      <title id={`${scope}-map-title`}>{world.city.name}</title>
      <desc id={`${scope}-map-desc`}>
        Compare forecast demand on the left with paid preorders on the right. Select one of three venues.
      </desc>
      <defs>
        <clipPath id={`${scope}-land-clip`}>
          <path clipRule="evenodd" d={`M0 0H1000V700H0Z ${waterPath}`} />
        </clipPath>
        <pattern
          id={`${scope}-water-hatch`}
          width="18"
          height="18"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <path d="M0 0V18" stroke="#7895A5" opacity=".18" />
        </pattern>
        <pattern
          id={`${scope}-paid-hatch`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <path d="M0 0V6" stroke="var(--paid)" strokeWidth="3" />
        </pattern>
        <clipPath id={`${scope}-forecast-clip`}>
          <rect x="-1000" y="0" width={Math.max(0, (splitX ?? 1000) + 1000)} height="700" />
        </clipPath>
        <clipPath id={`${scope}-preorders-clip`}>
          <rect x={splitX ?? 0} y="0" width={Math.max(0, 2000 - (splitX ?? 0))} height="700" />
        </clipPath>
      </defs>
      <rect width="1000" height="700" fill="var(--paper)" />
      <g clipPath={`url(#${scope}-land-clip)`}>
        <g data-layer="heat" clipPath={splitX === undefined ? undefined : `url(#${scope}-forecast-clip)`}>
          {world.heat.map((h, i) => (
            <polygon
              key={i}
              tabIndex={0}
              aria-label={workerText(h)}
              onMouseEnter={() => setActiveCell(h)}
              onMouseLeave={() => setActiveCell(null)}
              onFocus={() => setActiveCell(h)}
              onBlur={() => setActiveCell(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setActiveCell(null);
              }}
              points={Array.from(
                { length: 6 },
                (_, n) =>
                  `${h.x + (h.radius ?? 22) * Math.cos((n * Math.PI) / 3)},${h.y + (h.radius ?? 22) * Math.sin((n * Math.PI) / 3)}`,
              ).join(' ')}
              fill="var(--forecast)"
              opacity={0.04 + h.interest * 0.3}
            >
              <title>{workerText(h)}</title>
            </polygon>
          ))}
        </g>
      </g>
      <path d={waterPath} fill="#122E46" fillRule="evenodd" />
      <path d={waterPath} fill={`url(#${scope}-water-hatch)`} fillRule="evenodd" />
      <g pointerEvents="none" data-layer="roads">
        {geometry.roads.map((road, i) => (
          <polyline
            key={i}
            points={points(road.points)}
            stroke="#B2A895"
            strokeWidth={road.class === 'major' ? 2 : 0.7}
            fill="none"
          />
        ))}
      </g>
      <g pointerEvents="none" data-layer="labels">
        {geometry.labels.map((label) => (
          <text
            key={`${label.kind}-${label.text}`}
            className={`map-label ${label.kind}-label ${label.kind === 'water' || phoneStreets.includes(label) ? 'phone-label' : ''}`}
            x={label.x}
            y={label.y}
            transform={`rotate(${label.angle} ${label.x} ${label.y})`}
            textAnchor={label.x < 80 ? 'start' : label.x > 920 ? 'end' : 'middle'}
          >
            {label.text}
          </text>
        ))}
      </g>
      <g clipPath={splitX === undefined ? undefined : `url(#${scope}-forecast-clip)`}>
        {campaign.venues.map((v) => {
          const site = world.venues.find((s) => s.id === v.id)!;
          return (
            <circle
              key={v.id}
              cx={site.x}
              cy={site.y}
              r={12 + Math.sqrt(v.forecastUnits) * 2}
              fill="none"
              stroke="var(--forecast)"
              strokeWidth="7"
              opacity=".8"
            />
          );
        })}
      </g>
      <g clipPath={splitX === undefined ? undefined : `url(#${scope}-preorders-clip)`}>
        {campaign.venues.map((v) => {
          const site = world.venues.find((s) => s.id === v.id)!;
          const total = ringTotal(v, !!world.recorded?.recordedAt, includeRecorded);
          const radius = 15 + Math.sqrt(total) * 5;
          if (!total) return null;
          return (
            <g key={v.id}>
              <circle
                cx={site.x}
                cy={site.y}
                r={radius}
                fill="none"
                stroke="var(--paid)"
                strokeWidth="9"
                opacity=".2"
              />
              <circle
                cx={site.x}
                cy={site.y}
                r={radius}
                fill="none"
                stroke={`url(#${scope}-paid-hatch)`}
                strokeWidth="9"
              />
              <circle
                cx={site.x}
                cy={site.y}
                r={radius}
                fill="none"
                stroke="var(--paid)"
                strokeWidth="9"
                strokeDasharray={`${total ? (v.paidUnits / total) * 2 * Math.PI * radius : 0} ${2 * Math.PI * radius}`}
                transform={`rotate(-90 ${site.x} ${site.y})`}
              />
            </g>
          );
        })}
        {preorderDots}
      </g>
      {world.venues.map((v) => (
        <g
          key={v.id}
          role="button"
          tabIndex={0}
          aria-label={`Select ${v.name}${pinLabelSuffix}`}
          aria-pressed={selected === v.id}
          onClick={() => onSelect(v.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(v.id);
            }
          }}
          className="venue-pin"
        >
          <circle cx={v.x} cy={v.y} r="24" fill="transparent" />
          <circle
            cx={v.x}
            cy={v.y}
            r={selected === v.id ? 11 : 8}
            fill="var(--ink)"
            stroke="var(--paper)"
            strokeWidth="4"
          />
          <text x={v.x} y={v.y - 48} textAnchor="middle">
            {v.id === 'wharf' ? 'Shed 9' : v.name}
          </text>
        </g>
      ))}
      {activeCell && (
        <g
          role="tooltip"
          pointerEvents="none"
          transform={`translate(${Math.max(160, Math.min(840, activeCell.x))} ${Math.max(40, activeCell.y - 32)})`}
        >
          <rect x="-156" y="-24" width="312" height="34" rx="6" fill="var(--surface)" stroke="var(--ink)" />
          <text textAnchor="middle" y="-2" fill="var(--text)" fontSize="14">
            {workerText(activeCell)}
          </text>
        </g>
      )}
    </svg>
  );
}
