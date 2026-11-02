import type { Contest } from '../types';

type Kind = 'photo' | 'design' | 'writing' | 'video' | 'festive' | 'team' | 'general';

export function kindOf(c?: Pick<Contest, 'name' | 'theme' | 'entryTypes'> | null): Kind {
  if (!c) return 'general';
  const t = `${c.name} ${c.theme}`.toLowerCase();
  if (/rangoli|festiv|diwali|holi|christmas|holiday|celebrat/.test(t)) return 'festive';
  if (/poster|design|logo|card|art|draw|desk/.test(t)) return 'design';
  if (/haiku|writ|story|poem|essay|blog/.test(t) || (c.entryTypes.length === 1 && c.entryTypes[0] === 'writing')) return 'writing';
  if (/video|film|reel|short/.test(t) || (c.entryTypes.length === 1 && c.entryTypes[0] === 'video')) return 'video';
  if (/team|moment|together|us at/.test(t)) return 'team';
  if (/photo|lens|shot|camera|pet|monsoon|memor/.test(t) || c.entryTypes.includes('image')) return 'photo';
  return 'general';
}

const sw = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const;
const ART: Record<Kind, () => React.JSX.Element> = {
  photo: () => (
    <g {...sw}>
      {[280, 220, 160, 100, 50].map((r) => <circle key={r} r={r} />)}
      {Array.from({ length: 8 }, (_, i) => <path key={i} d="M0 -100 L86 -50 L0 -160" transform={`rotate(${i * 45})`} />)}
    </g>
  ),
  festive: () => (
    <g {...sw}>
      {Array.from({ length: 16 }, (_, i) => <ellipse key={i} cx="0" cy="-130" rx="30" ry="80" transform={`rotate(${i * 22.5})`} />)}
      {Array.from({ length: 12 }, (_, i) => <circle key={i} cx="0" cy="-235" r="11" transform={`rotate(${i * 30})`} />)}
      <circle r="62" /><circle r="30" />
    </g>
  ),
  design: () => (
    <g {...sw}>
      <rect x="-190" y="-120" width="190" height="190" rx="18" transform="rotate(-12)" />
      <circle cx="90" cy="-30" r="110" />
      <path d="M-80 190 L50 -20 L190 190 Z" />
      <path d="M-260 190 C-120 70 0 280 160 150" />
    </g>
  ),
  writing: () => (
    <g {...sw} strokeLinecap="round">
      {Array.from({ length: 10 }, (_, i) => <path key={i} d={`M-260 ${-170 + i * 38} q 90 -24 180 0 t 180 0 t 180 0`} />)}
      <path d="M170 -190 l60 60 -170 170 -70 12 12 -70z" />
    </g>
  ),
  video: () => (
    <g {...sw}>
      <rect x="-270" y="-90" width="540" height="180" rx="12" />
      {Array.from({ length: 16 }, (_, i) => <rect key={i} x={-254 + i * 33} y={-80} width="16" height="16" rx="3" />)}
      {Array.from({ length: 16 }, (_, i) => <rect key={i} x={-254 + i * 33} y={64} width="16" height="16" rx="3" />)}
      <path d="M-24 -40 L48 0 L-24 40 Z" />
    </g>
  ),
  team: () => (
    <g {...sw}>
      {[[-150, 30, 58], [0, -10, 70], [150, 30, 58], [-75, 130, 46], [75, 130, 46]].map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y})`}><circle cy={-r * 0.35} r={r * 0.4} /><path d={`M${-r * 0.85} ${r * 0.95} a ${r * 0.85} ${r * 0.85} 0 0 1 ${r * 1.7} 0`} /></g>
      ))}
      <path d="M-210 190 Q0 50 210 190" />
    </g>
  ),
  general: () => (
    <g {...sw}>{[260, 190, 120, 60].map((r) => <circle key={r} r={r} strokeDasharray="4 10" />)}</g>
  ),
};

/** Whole-page, contest-themed background. Purely decorative and generic, so it never hints at the entries.
 *  Every contest's artwork stays mounted and cross-fades, so changing slides never flickers. */
export default function PageBackdrop({ contests, active }: { contests: Pick<Contest, 'name' | 'theme' | 'entryTypes'>[]; active: number }) {
  const kinds = [...new Set((contests.length ? contests : [null]).map((c) => kindOf(c)))];
  const current = kindOf(contests[active] ?? null);
  return (
    <div className="page-bg" aria-hidden>
      <div className="pg-glow g1" /><div className="pg-glow g2" /><div className="pg-glow g3" />
      {kinds.map((k) => {
        const Art = ART[k];
        return (
          <div key={k} className={`pg-kind ${k === current ? 'on' : ''}`}>
            <svg className="pg-art p1" viewBox="-300 -300 600 600"><Art /></svg>
            <svg className="pg-art p2" viewBox="-300 -300 600 600"><Art /></svg>
          </div>
        );
      })}
      <div className="pg-dots" />
    </div>
  );
}
