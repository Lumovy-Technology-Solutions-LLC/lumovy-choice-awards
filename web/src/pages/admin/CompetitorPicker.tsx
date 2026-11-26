import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { api } from '../../api';

export interface Person { id: number; name: string; email: string; team: string; region: string }

/** Searchable drop-down of existing employees: type part of a name, email or team to narrow the list. */
export default function CompetitorPicker({ id, value, onChange, countOf, max }: {
  id: string; value: { id: number; name: string } | null; onChange: (p: Person | null) => void;
  /** how many entries a person already has in this contest (not counting the one being edited) */
  countOf: (userId: number) => number; max: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 200); return () => clearTimeout(t); }, [text]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const q = useQuery({ queryKey: ['user-lookup', term], enabled: open, staleTime: 30_000, queryFn: () => api.get<{ users: Person[] }>(`/api/admin/users/lookup?q=${encodeURIComponent(term)}`) });
  const users = q.data?.users ?? [];
  const full = (u: Person) => !!max && countOf(u.id) >= max;
  useEffect(() => setHi(0), [term, open]);

  const choose = (u: Person) => {
    if (full(u)) return;
    onChange(u); setOpen(false); setText('');
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(users.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && open && users[hi]) { e.preventDefault(); choose(users[hi]); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="combo" ref={box}>
      <div style={{ position: 'relative' }}>
        <input id={id} className="input" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
          placeholder={value ? value.name : 'Search employees by name, email or team'}
          value={open ? text : value?.name ?? ''} style={{ paddingRight: value ? 64 : 34 }}
          onFocus={() => { setOpen(true); setText(''); }} onChange={(e) => { setText(e.target.value); setOpen(true); }} onKeyDown={onKey} />
        {value && <button type="button" className="icon-btn" aria-label="Clear competitor" style={{ position: 'absolute', right: 30, top: 4, width: 30, height: 30 }} onClick={() => { onChange(null); setText(''); }}><X size={14} /></button>}
        <ChevronDown size={16} style={{ position: 'absolute', right: 10, top: 12, pointerEvents: 'none', opacity: 0.6 }} />
      </div>
      {open && (
        <ul className="combo-list" id={listId} role="listbox" aria-label="Employees">
          {q.isLoading && <li aria-disabled="true">Searching…</li>}
          {!q.isLoading && users.length === 0 && <li aria-disabled="true">No employee matches “{term}”.</li>}
          {users.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === hi} aria-disabled={full(u)} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(u); }}>
              <span>{u.name}{u.id === value?.id ? ' ✓' : ''}</span>
              <small>{u.email}{u.team ? ` · ${u.team}` : ''}{full(u) ? ` · already has ${max} ${max === 1 ? 'entry' : 'entries'} (limit reached)` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
