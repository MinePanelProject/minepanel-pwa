/**
 * Panel-scoped TanStack Query key factory.
 *
 * Every remote query key starts with the immutable instance identity tuple
 * (saved record id + canonical origin). User-visible data keys also carry the
 * authenticated profile id, so sequential users of one panel can never read
 * each other's cached rows. Key elements are primitives — never objects.
 *
 * Removal/invalidation is always done through `panelKeys.root(panel)`
 * prefixes; the default five-minute gcTime must never be relied on as the
 * security cleanup at identity boundaries.
 */

export type InstanceIdentity = Readonly<{ id: string; origin: string }>;
export type ServerPage = Readonly<{ limit: number; offset: number }>;

export const panelKeys = {
  root: (panel: InstanceIdentity) => ['panel', panel.id, panel.origin] as const,

  info: (panel: InstanceIdentity) => [...panelKeys.root(panel), 'info'] as const,

  setupStatus: (panel: InstanceIdentity) => [...panelKeys.root(panel), 'setup-status'] as const,

  profile: (panel: InstanceIdentity) => [...panelKeys.root(panel), 'auth', 'profile'] as const,

  userRoot: (panel: InstanceIdentity, userId: string) =>
    [...panelKeys.root(panel), 'user', userId] as const,

  servers: (panel: InstanceIdentity, userId: string, page: ServerPage) =>
    [...panelKeys.userRoot(panel, userId), 'servers', 'list', page.limit, page.offset] as const,

  requestableServers: (panel: InstanceIdentity, userId: string, page: ServerPage) =>
    [...panelKeys.userRoot(panel, userId), 'servers', 'requestable', page.limit, page.offset] as const,

  server: (panel: InstanceIdentity, userId: string, serverId: string) =>
    [...panelKeys.userRoot(panel, userId), 'servers', 'detail', serverId] as const,

  myAccess: (panel: InstanceIdentity, userId: string, serverId: string) =>
    [...panelKeys.userRoot(panel, userId), 'servers', serverId, 'my-access'] as const,

  accessRequests: (panel: InstanceIdentity, userId: string, serverId: string) =>
    [...panelKeys.userRoot(panel, userId), 'servers', serverId, 'access-requests'] as const,

  sessions: (panel: InstanceIdentity, userId: string) =>
    [...panelKeys.userRoot(panel, userId), 'auth', 'sessions'] as const,

  adminUsers: (panel: InstanceIdentity, userId: string, status: string | null, role: string | null) =>
    [...panelKeys.userRoot(panel, userId), 'admin', 'users', status, role] as const,

  adminPermissions: (panel: InstanceIdentity, userId: string, targetUserId: string) =>
    [...panelKeys.userRoot(panel, userId), 'admin', 'users', targetUserId, 'permissions'] as const,

  systemStats: (panel: InstanceIdentity, userId: string) =>
    [...panelKeys.userRoot(panel, userId), 'system', 'stats'] as const,
};