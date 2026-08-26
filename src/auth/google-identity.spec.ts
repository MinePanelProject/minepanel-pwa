import { describe, expect, it, vi } from 'vitest';
import { GoogleIdentity, type GoogleCredentialResponse, type GoogleIdentityApi } from './google-identity';

describe('GoogleIdentity', () => {
  it('passes the backend-issued challenge as the GIS nonce and forwards a transient credential', async () => {
    let callback: ((response: GoogleCredentialResponse) => void) | undefined;
    const initialize = vi.fn((configuration: { callback: (response: GoogleCredentialResponse) => void }) => {
      callback = configuration.callback;
    });
    const renderButton = vi.fn();
    const api: GoogleIdentityApi = { accounts: { id: { initialize, renderButton } } };
    const onCredential = vi.fn();
    const onError = vi.fn();
    const container = document.createElement('div');

    await new GoogleIdentity(async () => api).renderButton(container, {
      clientId: 'client.apps.googleusercontent.com',
      nonce: 'A'.repeat(43),
      onCredential,
      onError,
    });
    callback?.({ credential: 'transient-google-id-token' });

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client.apps.googleusercontent.com',
      nonce: 'A'.repeat(43),
    }));
    expect(renderButton).toHaveBeenCalledWith(container, expect.objectContaining({ text: 'continue_with' }));
    expect(onCredential).toHaveBeenCalledWith('transient-google-id-token');
    expect(onError).not.toHaveBeenCalled();
  });
});
