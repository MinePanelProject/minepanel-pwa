/**
 * Typed request/response contracts for the MinePanel protocol-1 API.
 *
 * Mirrors the backend's public DTOs and projections exactly (SPEC §7;
 * `PublicUser`/`PublicServer` omit only secrets). Enums are duplicated from
 * `db/schema.ts` — the backend is authoritative; never extend from UI
 * invention.
 */

// --- Enums ---

export const ROLES = ['ADMIN', 'MOD', 'USER'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'PENDING', 'BANNED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SERVER_PROVIDERS = ['VANILLA', 'PAPER', 'PURPUR', 'FABRIC', 'FORGE'] as const;
export type ServerProvider = (typeof SERVER_PROVIDERS)[number];

export const SERVER_STATUSES = [
  'STOPPED',
  'CREATING',
  'STARTING',
  'RUNNING',
  'STOPPING',
  'ERROR',
] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

export const DIFFICULTIES = ['PEACEFUL', 'EASY', 'NORMAL', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const GAMEMODES = ['SURVIVAL', 'CREATIVE', 'ADVENTURE', 'SPECTATOR'] as const;
export type Gamemode = (typeof GAMEMODES)[number];

export const ACCESS_TYPES = ['OPEN', 'REQUEST', 'PRIVATE'] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

export const ACCESS_STATUSES = ['PENDING', 'APPROVED'] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const MOD_PERMISSIONS = [
  'SERVER_LIFECYCLE',
  'SERVER_CONFIG',
  'PLUGIN_MANAGEMENT',
  'WHITELIST_MANAGEMENT',
  'USER_MANAGEMENT',
  'FILE_MANAGER',
] as const;
export type ModPermission = (typeof MOD_PERMISSIONS)[number];

// --- Panel capability discovery (GET /api/info) ---

export type PanelCapabilities = {
  auth: {
    partitionedCookies: boolean;
    pkceAuthorizationCode: boolean;
    googleOAuth: boolean;
  };
  realtime: {
    websocketTicket: boolean;
  };
  /**
   * Optional on the wire: legacy protocol-1 backends predating requestable
   * discovery omit this object entirely, and such panels must remain fully
   * compatible. `supportsRequestableDiscovery` is the single capability helper.
   */
  servers?: {
    requestableDiscovery: boolean;
  };
};

export type PanelInfo = {
  name: string;
  version: string;
  api: {
    protocolVersion: number;
  };
  capabilities: PanelCapabilities;
};

// --- Setup ---

export type SetupStatus = {
  initialAdminCreated: boolean;
  nextStep: 'register_admin' | 'complete';
};

// --- Auth ---

export type RegisterInput = {
  email: string;
  username: string;
  password: string;
};

export type LoginInput = {
  identifier: string;
  password: string;
};

export type TwoFactorChallenge = {
  requiresTwoFactor: true;
  preAuthToken: string;
};

export type TwoFactorSetupResult = {
  secret: string;
  uri: string;
};

export type TwoFactorConfirmResult = {
  backupCodes: string[];
};

/** `req.user` shape returned by GET /api/auth/profile. */
export type AuthProfile = {
  id: string;
  username: string;
  role: Role;
  temporaryAuth?: boolean;
};

/** Refresh-token session row (GET /api/auth/sessions). */
export type SessionRow = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

/** PublicUser — secrets stripped by the backend. */
export type PublicUser = {
  id: string;
  email: string;
  username: string;
  googleId: string | null;
  githubId: string | null;
  role: Role;
  status: UserStatus;
  totpEnabled: boolean;
  tempPasswordExpiresAt: string | null;
  mustChangePassword: boolean;
  minecraftUUID: string | null;
  minecraftName: string | null;
  minecraftVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

// --- Servers ---

/** PublicServer projection (secrets omitted by backend). */
export type Server = {
  id: string;
  name: string;
  provider: ServerProvider;
  version: string;
  port: number;
  status: ServerStatus;
  maxPlayers: number;
  difficulty: Difficulty;
  gamemode: Gamemode;
  pvp: boolean;
  memoryLimitMb: number;
  motd: string | null;
  levelSeed: string | null;
  onlineMode: boolean;
  viewDistance: number;
  allowFlight: boolean;
  ownerId: string;
  accessType: AccessType;
  createdAt: string;
  updatedAt: string;
};

export type ServerListResponse = {
  data: Server[];
  total: number;
};

export type CreateServerInput = {
  name: string;
  provider: ServerProvider;
  version: string;
  port: number;
  maxPlayers?: number;
  difficulty?: Difficulty;
  gamemode?: Gamemode;
  pvp?: boolean;
  memoryLimitMb?: number;
  motd?: string;
  levelSeed?: string;
  onlineMode?: boolean;
  viewDistance?: number;
  accessType?: AccessType;
  allowFlight?: boolean;
};

// --- Requestable server discovery (owner-approved slice) ---

export type RequestableServerProjection = {
  id: string;
  name: string;
  accessType: 'REQUEST';
  requestStatus: 'PENDING' | null;
};

// --- Server access ---

export type MyAccessRequest = {
  status: AccessStatus;
  requestedAt: string;
  approvedAt: string | null;
};

export type AccessRequest = {
  userId: string;
  username: string;
  email: string;
  status: AccessStatus;
  requestedAt: string;
  approvedAt: string | null;
};

// --- Admin ---

export type ModPermissionRow = {
  id: string;
  userId: string;
  permission: ModPermission;
  serverId: string | null;
  createdAt: string;
};

export type GrantModPermissionInput = {
  permission: ModPermission;
  serverId?: string | null;
};

export type ResetPasswordResult = {
  tempPassword: string;
};

// --- Realtime ---

export type SystemStats = {
  totalRamMb: number;
  usedRamMb: number;
  freeDiskMb: number;
  cpuCount: number;
};

// --- Runtime validators (reject unexpected backend shapes as incompatible) ---

export const isAuthProfile = (value: unknown): value is AuthProfile => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === 'string' &&
    typeof profile.username === 'string' &&
    typeof profile.role === 'string' &&
    ROLES.includes(profile.role as Role) &&
    (profile.temporaryAuth === undefined || typeof profile.temporaryAuth === 'boolean')
  );
};

export const isPublicUser = (value: unknown): value is PublicUser => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.username === 'string' &&
    typeof user.role === 'string' &&
    ROLES.includes(user.role as Role) &&
    typeof user.status === 'string' &&
    USER_STATUSES.includes(user.status as UserStatus)
  );
};

export const isServer = (value: unknown): value is Server => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const server = value as Record<string, unknown>;
  return (
    typeof server.id === 'string' &&
    typeof server.name === 'string' &&
    typeof server.provider === 'string' &&
    SERVER_PROVIDERS.includes(server.provider as ServerProvider) &&
    typeof server.version === 'string' &&
    typeof server.port === 'number' &&
    typeof server.status === 'string' &&
    SERVER_STATUSES.includes(server.status as ServerStatus) &&
    typeof server.accessType === 'string' &&
    ACCESS_TYPES.includes(server.accessType as AccessType) &&
    typeof server.ownerId === 'string'
  );
};

export const isServerListResponse = (value: unknown): value is ServerListResponse => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const list = value as Record<string, unknown>;
  return Array.isArray(list.data) && list.data.every(isServer) && typeof list.total === 'number';
};

export const isSessionRow = (value: unknown): value is SessionRow => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.userId === 'string' &&
    typeof row.expiresAt === 'string' &&
    typeof row.createdAt === 'string'
  );
};

export const isMyAccessRequest = (value: unknown): value is MyAccessRequest => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.status === 'string' &&
    ACCESS_STATUSES.includes(row.status as AccessStatus) &&
    typeof row.requestedAt === 'string' &&
    (row.approvedAt === null || typeof row.approvedAt === 'string')
  );
};

export const isSystemStats = (value: unknown): value is SystemStats => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const stats = value as Record<string, unknown>;
  return (
    typeof stats.totalRamMb === 'number' &&
    typeof stats.usedRamMb === 'number' &&
    typeof stats.freeDiskMb === 'number' &&
    typeof stats.cpuCount === 'number' &&
    [stats.totalRamMb, stats.usedRamMb, stats.freeDiskMb, stats.cpuCount].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
    )
  );
};