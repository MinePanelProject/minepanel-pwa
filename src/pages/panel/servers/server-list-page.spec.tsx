import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ServerStatus } from '@/api/types';
import { ServerStatusChip } from './server-list-page';

describe('ServerStatusChip', () => {
  it('renders a textual status alongside the secondary color dot for every backend status', () => {
    const statuses: ServerStatus[] = ['STOPPED', 'CREATING', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR'];

    for (const status of statuses) {
      const markup = renderToStaticMarkup(<ServerStatusChip status={status} />);
      expect(markup).toContain(status);
      expect(markup).toContain('status-dot');
    }
  });
});
