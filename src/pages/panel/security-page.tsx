import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import type { SessionRow } from '@/api/types';
import { getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import { usePanelSession, useSessionController } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { GoogleLinkControl } from '@/components/google-link-control';

type Enrollment = { secret: string; uri: string } | null;

export const SecurityPage = (): React.JSX.Element => {
  const { panel, client, state, info, notifyProfileChanged } = usePanelSession();
  const queryClient = useQueryClient();
  const controller = useSessionController();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const authenticated = state.kind === 'authenticated' && panel !== null && client !== null;
  const profile = state.kind === 'authenticated' ? state.profile : null;
  const sessions = useQuery({
    queryKey: panelKeys.sessions(panel ?? { id: 'unselected', origin: 'https://invalid.local' }, profile?.id ?? 'anonymous'),
    queryFn: async (): Promise<SessionRow[]> => {
      if (client === null) return [];
      return client.listSessions();
    },
    enabled: authenticated && profile !== null,
    staleTime: 30_000,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => () => {
    setEnrollment(null);
    setBackupCodes(null);
  }, []);

  useEffect(() => {
    if (enrollment === null || canvasRef.current === null) return;
    void QRCode.toCanvas(canvasRef.current, enrollment.uri, { errorCorrectionLevel: 'M', margin: 1 }).catch(() => {
      setError('The authenticator QR code could not be rendered. Use the manual secret instead.');
    });
  }, [enrollment]);

  if (!authenticated || profile === null || panel === null || client === null) return <Alert kind="warning">Sign in to manage account security.</Alert>;

  const invalidateSecurity = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: panelKeys.profile(panel) });
    await queryClient.invalidateQueries({ queryKey: panelKeys.sessions(panel, profile.id) });
    notifyProfileChanged();
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (newPassword !== passwordConfirmation) {
      setError('The new password confirmation does not match.');
      return;
    }
    setPasswordBusy(true);
    setError(null);
    try {
      await client.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setPasswordConfirmation('');
      setFeedback('Password changed.');
      await invalidateSecurity();
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setPasswordBusy(false);
    }
  };

  const beginEnrollment = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await client.setupTwoFactor());
      setBackupCodes(null);
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrollment = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const code = enrollmentCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the current six-digit authenticator code.');
      return;
    }
    setBusy(true);
    setError(null);
    setEnrollmentCode('');
    try {
      const result = await client.confirmTwoFactor(code);
      setEnrollment(null);
      setBackupCodes(result.backupCodes);
      await invalidateSecurity();
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const copyManualSecret = async (): Promise<void> => {
    if (enrollment === null || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setFeedback('Manual secret copied. Store it securely.');
    } catch {
      setError('The manual secret could not be copied. Select it manually instead.');
    }
  };

  const disableTwoFactor = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await client.disableTwoFactor(disableCode.trim().toLowerCase());
      setDisableCode('');
      setDisableOpen(false);
      setFeedback('Two-factor authentication disabled.');
      await invalidateSecurity();
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const revokeSession = async (sessionId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await client.revokeSession(sessionId);
      await queryClient.invalidateQueries({ queryKey: panelKeys.sessions(panel, profile.id) });
      notifyProfileChanged();
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await controller.signOutAll();
      setLogoutAllOpen(false);
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-8" aria-labelledby="security-heading">
      <div><p className="pixel-label text-accent">[ Security ]</p><h1 className="page-title mt-2" id="security-heading">Security</h1><p className="mt-2 text-sm text-ink-muted">Manage passwords, two-factor authentication, and browser sessions.</p></div>
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      {feedback ? <Alert kind="success" role="status">{feedback}</Alert> : null}
      <form className="grid gap-4 panel-surface p-5" onSubmit={(event) => void changePassword(event)}><h2 className="text-lg font-bold">Change password</h2><Field id="security-old-password" label="Current password" type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required /><Field id="security-new-password" label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><Field id="security-password-confirmation" label="Confirm new password" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /><Button type="submit" loading={passwordBusy}>Change password</Button></form>
      <section className="grid gap-4 panel-surface p-5" aria-labelledby="two-factor-security-heading"><h2 className="text-lg font-bold" id="two-factor-security-heading">Two-factor authentication</h2>{enrollment === null && backupCodes === null ? <Button onClick={() => void beginEnrollment()} loading={busy}>Set up two-factor authentication</Button> : null}{enrollment !== null ? <><p className="text-sm text-ink-muted">Scan this QR code with your authenticator app, or enter the manual secret.</p><canvas ref={canvasRef} aria-label="QR code for authenticator enrollment" className="max-w-full bg-surface-raised p-3" /><div className="grid gap-2"><p className="break-all font-mono text-sm text-ink">{enrollment.secret}</p><Button variant="secondary" onClick={() => void copyManualSecret()}>Copy manual secret</Button></div><form className="grid gap-4" onSubmit={(event) => void confirmEnrollment(event)}><Field id="two-factor-enrollment-code" label="Authenticator code" autoComplete="one-time-code" inputMode="numeric" value={enrollmentCode} onChange={(event) => setEnrollmentCode(event.target.value)} required /><div className="flex flex-wrap gap-3"><Button type="submit" loading={busy}>Confirm two-factor authentication</Button><Button type="button" variant="secondary" onClick={() => { setEnrollment(null); setEnrollmentCode(''); }}>Cancel</Button></div></form></> : null}{backupCodes !== null ? <Alert kind="warning" role="status" title="Store your backup codes now"><div className="grid gap-4"><p>These codes are shown once. Store them securely before leaving this screen.</p><ul className="grid gap-1 font-mono text-sm">{backupCodes.map((code) => <li key={code}>{code}</li>)}</ul><Button onClick={() => setBackupCodes(null)}>I have stored these codes</Button></div></Alert> : null}<div className="grid gap-3 border-t border-line pt-5"><Field id="two-factor-disable-code" label="Code to disable two-factor authentication" hint="Use a current authenticator or backup code." autoComplete="one-time-code" value={disableCode} onChange={(event) => setDisableCode(event.target.value)} /><Button variant="danger" onClick={() => setDisableOpen(true)} disabled={disableCode.trim().length === 0}>Disable two-factor authentication</Button></div></section>
      {(state.kind === 'authenticated' && info !== null) ? <GoogleLinkControl info={info} /> : null}
      <section className="grid gap-4 panel-surface p-5" aria-labelledby="sessions-heading"><div><h2 className="text-lg font-bold" id="sessions-heading">Sessions</h2><p className="text-sm text-ink-muted">Revoke a session to end it server-side: it can no longer obtain new access tokens and signs out when its current access token expires (up to 15 minutes). This applies to every revoked session, including this browser&rsquo;s.</p></div>{sessions.isLoading ? <span className="flex items-center gap-2 text-sm text-ink-muted"><Spinner />Loading sessions</span> : sessions.data?.length ? <ul className="grid gap-3">{sessions.data.map((session) => <li className="flex flex-wrap items-center justify-between gap-3 border border-line p-3" key={session.id}><span className="min-w-0 break-all text-sm text-ink-muted">Created {new Date(session.createdAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleString()}</span><Button variant="secondary" loading={busy} onClick={() => void revokeSession(session.id)}>Revoke</Button></li>)}</ul> : <EmptyState title="No active sessions" description="This panel did not return any active refresh sessions." />}<Button variant="danger" onClick={() => setLogoutAllOpen(true)}>Sign out every device</Button></section>
      <ConfirmDialog open={disableOpen} title="Disable two-factor authentication?" confirmLabel="Disable two-factor authentication" danger busy={busy} onConfirm={() => void disableTwoFactor()} onCancel={() => setDisableOpen(false)}>Enter the code above to confirm this change.</ConfirmDialog>
      <ConfirmDialog open={logoutAllOpen} title="Sign out every device?" confirmLabel="Sign out every device" danger busy={busy} onConfirm={() => void logoutAll()} onCancel={() => setLogoutAllOpen(false)}>This will sign out every device, including this one.</ConfirmDialog>
    </section>
  );
};
