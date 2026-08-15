import { createContext } from 'react';
import type { InstanceRegistry } from './instance-registry';

export const InstanceRegistryContext = createContext<InstanceRegistry | null>(null);
