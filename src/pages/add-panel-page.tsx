import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { BackendClient } from '@/api/backend-client';
import { getProbeErrorMessage } from '@/api/errors';
import { useInstanceRegistry } from '@/instances/use-instance-registry';
import { OriginValidationError, validatePanelOrigin } from '@/instances/origin-validation';

export const AddPanelPage = (): React.JSX.Element => {
  const registry = useInstanceRegistry();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitPanel = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(undefined);

    let canonicalOrigin: string;

    try {
      canonicalOrigin = validatePanelOrigin(origin);
    } catch (validationError) {
      setError(
        validationError instanceof OriginValidationError
          ? validationError.message
          : 'Enter a valid MinePanel origin.',
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const client = new BackendClient(canonicalOrigin);
      await client.getInfo();
      const instance = await registry.add({ origin: canonicalOrigin });
      await queryClient.invalidateQueries({ queryKey: ['instances'] });
      await navigate(`/panel/${instance.id}`);
    } catch (probeError) {
      setError(getProbeErrorMessage(probeError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl">
      <p className="pixel-title text-xs text-[#69f45a]">[ Add a backend ]</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#f1f6ed]">Connect directly</h1>
      <p className="mt-4 max-w-xl leading-7 text-[#bdc9b7]">
        Enter a browser-trusted public HTTPS origin. MinePanel will probe its public panel-info endpoint
        before saving non-secret connection metadata on this device.
      </p>

      <form className="panel-surface mt-8 grid gap-5 p-6 sm:p-8" onSubmit={(event) => void submitPanel(event)}>
        <label className="grid gap-2" htmlFor="panel-origin">
          <span className="font-bold text-[#f1f6ed]">Panel origin</span>
          <input
            className="w-full border-2 border-[#53604e] bg-[#10130f] px-4 py-3 font-mono text-sm text-[#f1f6ed] placeholder:text-[#778373]"
            id="panel-origin"
            name="panel-origin"
            placeholder="https://panel.example.com"
            value={origin}
            autoComplete="url"
            inputMode="url"
            onChange={(event) => setOrigin(event.target.value)}
          />
        </label>
        <p className="text-sm leading-6 text-[#aab7a3]">
          Paths, credentials, HTTP origins, IP addresses, and local-network hostnames are not accepted by
          the hosted dashboard. Localhost is available only in development builds.
        </p>
        {error && (
          <p className="border-l-4 border-[#e17878] bg-[#321d1d] px-4 py-3 text-sm leading-6 text-[#ffcece]" role="alert">
            {error}
          </p>
        )}
        <button
          className="w-fit cursor-pointer border-2 border-[#7fc95b] bg-[#5d9e3e] px-5 py-3 font-bold text-[#071006] transition hover:bg-[#69f45a] disabled:cursor-wait disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? 'Checking panel…' : 'Check and save panel'}
        </button>
      </form>
    </section>
  );
};
