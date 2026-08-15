import { type ReactNode, useState } from 'react';
import { InstanceRegistry } from './instance-registry';
import { InstanceRegistryContext } from './instance-registry-context';

type InstanceProviderProps = {
  children: ReactNode;
};

export const InstanceProvider = ({ children }: InstanceProviderProps): ReactNode => {
  const [registry] = useState(() => new InstanceRegistry());

  return <InstanceRegistryContext.Provider value={registry}>{children}</InstanceRegistryContext.Provider>;
};

