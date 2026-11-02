import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth, useToast, errMsg } from '../lib';
import { Field, Modal } from '../components/ui';

export default function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setErr('The two passwords do not match.'); return; }
    setBusy(true); setErr('');
    try {
      await api.post('/api/auth/password', { current: current || undefined, password: pw });
      await refresh(); toast('Password saved. You can now sign in with it.'); onClose();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }
  return (
    <Modal title={user?.hasPassword ? 'Change password' : 'Set a password'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="hint">{user?.hasPassword ? 'Enter your current password, then choose a new one.' : 'Optional. A password lets you sign in without waiting for an email code.'}</p>
        {user?.hasPassword && <Field label="Current password" htmlFor="cur"><input id="cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>}
        <Field label="New password" hint="At least 10 characters, with letters and numbers." htmlFor="np"><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Repeat new password" htmlFor="np2"><input id="np2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {err && <div className="notice bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !pw}>Save password</button>
        </div>
      </form>
    </Modal>
  );
}
