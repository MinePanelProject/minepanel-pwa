import { registerSW } from 'virtual:pwa-register';

export const registerServiceWorker = (): void => {
  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      if (window.confirm('A MinePanel update is ready. Reload now?')) {
        void updateServiceWorker(true);
      }
    },
  });
};
