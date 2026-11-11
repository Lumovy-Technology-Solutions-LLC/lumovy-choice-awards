import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { errMsg, fmtDateTime, useToast } from '../../lib';
import { ErrorState, PageLoader, Switch, useConfirm } from '../../components/ui';

export interface AdminSettings {
  emailNotifications: boolean; emailSignIn: boolean; transport: string; from: string;
  usersWithoutPassword: number; failedEmails24h: number;
  database: 'sqlite' | 'postgres'; backups: { dir: string; count: number; last: string | null; everyHours: number } | null;
}
export const settingsKey = ['admin-settings'];

export default function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const q = useQuery({ queryKey: settingsKey, queryFn: () => api.get<AdminSettings>('/api/admin/settings') });
  const save = useMutation({
    mutationFn: (patch: Partial<Pick<AdminSettings, 'emailNotifications' | 'emailSignIn'>>) => api.put<AdminSettings>('/api/admin/settings', patch),
    onSuccess: (d) => { qc.setQueryData(settingsKey, d); qc.invalidateQueries({ queryKey: ['outbox'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast('Settings saved.'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const backup = useMutation({
    mutationFn: () => api.post<AdminSettings>('/api/admin/backup'),
    onSuccess: (d) => { qc.setQueryData(settingsKey, d); toast('Backup saved.'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const s = q.data!;

  async function toggleNotifications(on: boolean) {
    if (on) return save.mutate({ emailNotifications: true });
    if (await confirm({ title: 'Switch off email notifications?', confirm: 'Switch off', danger: true, body: <>Contest started, vote confirmation, results, reminder and deadline emails will <b>not be sent</b> and nothing is saved to send later. Emails already waiting in the outbox are cancelled. Voting and results on the portal are not affected.</> })) save.mutate({ emailNotifications: false });
  }
  async function toggleSignIn(on: boolean) {
    if (on) return save.mutate({ emailSignIn: true });
    if (await confirm({ title: 'Switch off email sign-in codes?', confirm: 'Switch off', danger: true, body: <>The “Email code” option disappears from the sign-in page and only passwords work. <b>{s.usersWithoutPassword}</b> active {s.usersWithoutPassword === 1 ? 'person has' : 'people have'} no password and could not sign in until HR gives them access another way.</> })) save.mutate({ emailSignIn: false });
  }

  return (
    <>
      <div className="admin-top"><div><div className="eyebrow">HR admin</div><h1>Settings</h1><p className="hint" style={{ marginTop: 4 }}>Switch email on or off without redeploying.</p></div></div>

      <div className="card" style={{ padding: 20, display: 'grid', gap: 22 }}>
        <div className="row between" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0 }}>Email notifications</h3>
            <p className="hint" style={{ marginTop: 4, maxWidth: 560 }}>Contest started, “Your vote is in”, results declared, reminders and deadline-extended emails, and test emails. When off, these are skipped, not queued.</p>
          </div>
          <Switch label="Email notifications" checked={s.emailNotifications} disabled={save.isPending} onChange={toggleNotifications} />
        </div>

        <div className="row between" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0 }}>Email sign-in codes</h3>
            <p className="hint" style={{ marginTop: 4, maxWidth: 560 }}>The 6-digit “Email code” sign-in. When off, only passwords work. {s.usersWithoutPassword > 0 && <><b>{s.usersWithoutPassword}</b> active {s.usersWithoutPassword === 1 ? 'person has' : 'people have'} no password and rely on email codes.</>}</p>
          </div>
          <Switch label="Email sign-in codes" checked={s.emailSignIn} disabled={save.isPending} onChange={toggleSignIn} />
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>Email delivery</h3>
        <p className="hint" style={{ marginTop: 4 }}>
          Mode: <b>{s.transport === 'smtp' ? 'Live (Azure Communication Services)' : 'Test mode (nothing is sent)'}</b><br />
          Sent from: <b>{s.from}</b><br />
          Failed in the last 24 hours: <b>{s.failedEmails24h}</b>{s.failedEmails24h > 0 && ' — see Email outbox. If every email fails, the SMTP secret may have expired; update it in the web app’s environment variables.'}
        </p>
      </div>
      {s.backups && (
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <div className="row between" style={{ gap: 16, alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}>Database backups</h3>
              <p className="hint" style={{ marginTop: 4, maxWidth: 560 }}>
                A safe copy of everything (people, contests, votes) is saved automatically every {s.backups.everyHours} hours, when a contest starts and when voting closes. Last backup: <b>{s.backups.last ? fmtDateTime(s.backups.last) : 'none yet'}</b>. {s.backups.count} kept in <b>{s.backups.dir}</b> on the server.
                Take one before big changes, and keep a copy outside the server as well (see the deployment guide).
              </p>
            </div>
            <button className="btn btn-ghost" disabled={backup.isPending} onClick={() => backup.mutate()}>{backup.isPending ? 'Saving…' : 'Back up now'}</button>
          </div>
        </div>
      )}
      {confirmNode}
    </>
  );
}
