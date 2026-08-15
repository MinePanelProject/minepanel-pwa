import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { InstanceProvider } from '@/instances/instance-context';
import { createQueryClient } from './query-client';

type AppProvidersProps = {
  children: ReactNode;
};

export const AppProviders = ({ children }: AppProvidersProps): ReactNode => {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <InstanceProvider>{children}</InstanceProvider>
    </QueryClientProvider>
  );
};
