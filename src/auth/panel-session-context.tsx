import { createContext, useContext } from 'react';
import type { BackendClient } from '@/api/backend-client';
import type { PanelInfo } from '@/api/types';
import type { InstanceIdentity } from '@/api/query-keys';
import type { SessionController } from './session-controller';

export type BrowserIncompatibilityReason =
  | 'insecure-context'
  | 'web-locks-unavailable';

export type PanelIncompatibilityReason =
  | 'unsupported-protocol'
  | 'partitioned-auth-not-advertised';

export type SessionProblem =
  | { kind: 'offline' }
  | { kind: 'expired' }
  | { kind: 'incompatible'; subject: 'browser'; reason: BrowserIncompatibilityReason }
  | { kind: 'incompatible'; subject: 'panel'; reason: PanelIncompatibilityReason }
  | { kind: 'hosted-origin-forbidden' }
  | { kind: 'session-restore-failed' };

export type ShellSession =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; profile: { id: string; username: string; role: 'ADMIN' | 'MOD' | 'USER'; temporaryAuth?: false } }
  | { kind: 'two-factor-pending'; preAuthToken: string }
  | { kind: 'password-change-required' }
  | { kind: 'account-pending' }
  | { kind: 'account-banned' }
  | { kind: 'error'; problem: SessionProblem };

export type PanelSessionValue = {
  panel: InstanceIdentity | null;
  client: BackendClient | null;
  info: PanelInfo | null;
  infoError: unknown;
  state: ShellSession;
  signOut: () => Promise<void>;
  retryRestore: () => void;
  /** Re-reads profile after profile-affecting mutations (username, 2FA, password). */
  notifyProfileChanged: () => void;
};

export const PanelSessionContext = createContext<PanelSessionValue | null>(null);

export const usePanelSession = (): PanelSessionValue => {
  const value = useContext(PanelSessionContext);
  if (!value) throw new Error('usePanelSession must be used within PanelSessionProvider.');
  return value;
};

export const SessionControllerContext = createContext<SessionController | null>(null);

/** Local-auth screens use this internal controller API; feature pages use usePanelSession only. */
export const useSessionController = (): SessionController => {
  const controller = useContext(SessionControllerContext);
  if (!controller) throw new Error('useSessionController must be used within PanelSessionProvider.');
  return controller;
};