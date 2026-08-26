export type GoogleCredentialResponse = {
  credential?: string;
};

export type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize(configuration: {
        client_id: string;
        nonce: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select: false;
        cancel_on_tap_outside: true;
      }): void;
      renderButton(
        parent: HTMLElement,
        configuration: {
          theme: 'outline';
          size: 'large';
          text: 'continue_with';
        },
      ): void;
    };
  };
};
declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}


let identityApiPromise: Promise<GoogleIdentityApi> | undefined;

const loadGoogleIdentityApi = (): Promise<GoogleIdentityApi> => {
  if (identityApiPromise) {
    return identityApiPromise;
  }

  // DOM script events need completion callbacks; this ES2022 target lacks Promise.withResolvers.
  identityApiPromise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    if (window.google) {
      resolve(window.google);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      if (window.google) {
        resolve(window.google);
        return;
      }
      identityApiPromise = undefined;
      reject(new Error('Google Identity Services did not load.'));
    };
    script.onerror = () => {
      identityApiPromise = undefined;
      reject(new Error('Google Identity Services could not be loaded.'));
    };
    document.head.append(script);
  });

  return identityApiPromise;

};

export class GoogleIdentity {
  constructor(private readonly loadApi: () => Promise<GoogleIdentityApi> = loadGoogleIdentityApi) {}

  async renderButton(
    container: HTMLElement,
    input: {
      clientId: string;
      nonce: string;
      onCredential: (credential: string) => void;
      onError: (message: string) => void;
    },
  ): Promise<void> {
    try {
      const google = await this.loadApi();
      container.replaceChildren();
      google.accounts.id.initialize({
        client_id: input.clientId,
        nonce: input.nonce,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response) => {
          if (typeof response.credential === 'string' && response.credential.length > 0) {
            input.onCredential(response.credential);
            return;
          }
          input.onError('Google did not return a sign-in credential.');
        },
      });
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
      });
    } catch {
      input.onError('Google sign-in could not be loaded. Check your network settings and try again.');
    }
  }
}
