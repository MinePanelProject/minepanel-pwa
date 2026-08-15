import { useContext } from 'react';
import type { InstanceRegistry } from './instance-registry';
import { InstanceRegistryContext } from './instance-registry-context';

export const useInstanceRegistry = (): InstanceRegistry => {
  const registry = useContext(InstanceRegistryContext);

  if (!registry) {
    throw new Error('useInstanceRegistry must be used within InstanceProvider.');
  }

  return registry;
};
