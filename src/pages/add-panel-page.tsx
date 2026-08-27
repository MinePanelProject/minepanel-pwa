import { useQueryClient } from '@tanstack/react-query';
import { BackendClient } from '@/api/backend-client';
import { getProbeErrorMessage } from '@/api/errors';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import type { PanelInstance } from '@/instances/instance-registry';
import { useInstanceRegistry } from '@/instances/use-instance-registry';
import { OriginValidationError, validatePanelOrigin } from '@/instances/origin-validation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

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
      try {
        const client = new BackendClient(canonicalOrigin);
        await client.getInfo();
      } catch (probeError) {
        setError(getProbeErrorMessage(probeError));
        return;
      }

      let instance: PanelInstance;
      try {
        instance = await registry.add({ origin: canonicalOrigin });
      } catch (saveError) {
        setError(
          saveError instanceof Error && saveError.message === 'This panel is already saved.'
            ? saveError.message
            : 'The panel responded correctly, but it could not be saved on this device.',
        );
        return;
      }

      try {
        await queryClient.invalidateQueries({ queryKey: ['instances'] });
        await navigate(`/panel/${instance.id}`);
      } catch {
        setError('The panel was saved, but it could not be opened. Refresh this page to continue.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl">
      <p className="pixel-label text-xs text-accent">[ Add a backend ]</p>
      <h1 className="page-title mt-3">Connect directly</h1>
      <p className="mt-4 max-w-xl leading-7 text-ink-muted">
        Enter a browser-trusted public HTTPS origin. MinePanel will probe its public panel-info endpoint
        before saving non-secret connection metadata on this device.
      </p>

      <form className="panel-surface mt-8 grid gap-5 p-6 sm:p-8" onSubmit={(event) => void submitPanel(event)}>
        <Field
          id="panel-origin"
          name="panel-origin"
          label="Panel origin"
          placeholder="https://panel.example.com"
          value={origin}
          autoComplete="url"
          inputMode="url"
          onChange={(event) => setOrigin(event.target.value)}
          error={error}
        />
        <p className="text-sm leading-6 text-ink-muted">
          Paths, credentials, HTTP origins, IP addresses, and local-network hostnames are not accepted by
          the hosted dashboard. Localhost is available only in development builds.
        </p>
        <Button className="w-fit" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Checking panel…' : 'Check and save panel'}
        </Button>
      </form>
    </section>
  );
};