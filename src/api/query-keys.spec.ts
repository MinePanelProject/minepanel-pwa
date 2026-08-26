import { describe, expect, it } from 'vitest';
import { panelKeys } from './query-keys';

describe('requestable query-key isolation (owner-approved slice)', () => {
  it('scopes requestable keys by panel identity AND user', () => {
    const panelA = { id: 'panel-a', origin: 'https://a.example.test' };
    const panelB = { id: 'panel-b', origin: 'https://b.example.test' };
    const page = { limit: 20, offset: 0 };

    const keyA = panelKeys.requestableServers(panelA, 'user-1', page);
    const keyB = panelKeys.requestableServers(panelB, 'user-1', page);
    const keyAOtherUser = panelKeys.requestableServers(panelA, 'user-2', page);

    expect(keyA).not.toEqual(keyB);
    expect(keyA).not.toEqual(keyAOtherUser);
    expect(keyA).toContain('requestable');
    // The saved record id is part of the identity: a duplicate record with the
    // same canonical origin is a separate cache scope (cookies are shared per
    // origin via the session authority, query caches are per record).
    expect(panelKeys.requestableServers({ id: 'panel-a-duplicate', origin: panelA.origin }, 'user-1', page)).not.toEqual(keyA);
  });
});
