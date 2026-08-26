import type { AuthenticatedProfile, GoogleLoginResult } from '@/api/backend-client';

export interface GoogleAuthBackend {
  createGoogleChallenge(): Promise<string>;
  loginWithGoogle(credential: string): Promise<GoogleLoginResult>;
  linkGoogleAccount(credential: string): Promise<void>;
  getProfile(): Promise<AuthenticatedProfile | null>;
  logout(): Promise<void>;
}

export type GoogleLoginOutcome =
  | { kind: 'authenticated'; profile: AuthenticatedProfile }
  | { kind: 'link-confirmation-required'; canLinkCurrentSession: boolean };

/**
 * Keeps only the server-derived profile in memory. Credentials are method arguments
 * and therefore expire when their exchange settles; session tokens remain HttpOnly cookies.
 */
export class GoogleLoginFlow {
  private profile: AuthenticatedProfile | null = null;

  constructor(private readonly backend: GoogleAuthBackend) {}

  get currentProfile(): AuthenticatedProfile | null {
    return this.profile;
  }

  async restoreSession(): Promise<AuthenticatedProfile | null> {
    this.profile = await this.backend.getProfile();
    return this.profile;
  }

  async createChallenge(): Promise<string> {
    return this.backend.createGoogleChallenge();
  }

  async exchangeLoginCredential(credential: string): Promise<GoogleLoginOutcome> {
    const result = await this.backend.loginWithGoogle(credential);
    if (result.status === 'LinkConfirmationRequired') {
      this.profile = await this.backend.getProfile();
      return {
        kind: 'link-confirmation-required',
        canLinkCurrentSession: this.profile !== null,
      };
    }

    const profile = await this.backend.getProfile();
    if (!profile) {
      throw new Error('The panel did not restore the Google session it created.');
    }

    this.profile = profile;
    return { kind: 'authenticated', profile };
  }

  async linkGoogleCredential(credential: string): Promise<AuthenticatedProfile> {
    await this.backend.linkGoogleAccount(credential);
    const profile = await this.backend.getProfile();
    if (!profile) {
      throw new Error('The panel did not restore the session after linking Google.');
    }

    this.profile = profile;
    return profile;
  }

  async logout(): Promise<void> {
    this.profile = null;
    await this.backend.logout();
  }
}
