import type { AccessStatus, ServerStatus } from '@/api/types';

type PollStatus = Extract<ServerStatus, 'CREATING' | 'STARTING' | 'STOPPING' | 'ERROR'>;

type ServerPoller = {
  nextInterval: (status: ServerStatus | undefined, now?: number) => number | false;
  exhausted: () => boolean;
};

type AccessPoller = {
  nextInterval: (status: AccessStatus | null | undefined, now?: number) => number | false;
  exhausted: () => boolean;
};

/**
 * Bounded lifecycle polling per the architecture decision §6: transitional
 * states poll 2s × 30, ERROR polls 10s × 6, and both stop at 60s elapsed.
 * A generation is a returned status value; counters reset only when it
 * changes. Pure module state — never persisted.
 */
export const createServerPoller = (): ServerPoller => {
  let generation: PollStatus | null = null;
  let startedAt = 0;
  let polls = 0;
  let stopped = false;

  return {
    nextInterval(status, now = Date.now()) {
      if (status !== 'CREATING' && status !== 'STARTING' && status !== 'STOPPING' && status !== 'ERROR') {
        generation = null;
        polls = 0;
        stopped = false;
        return false;
      }
      if (generation !== status) {
        generation = status;
        startedAt = now;
        polls = 0;
        stopped = false;
      }
      const interval = status === 'ERROR' ? 10_000 : 2_000;
      const maximumPolls = status === 'ERROR' ? 6 : 30;
      if (stopped || polls >= maximumPolls || now - startedAt >= 60_000) {
        stopped = true;
        return false;
      }
      polls += 1;
      return interval;
    },
    exhausted() {
      return stopped;
    },
  };
};

/** Bounded PENDING access-request polling: 5s × 12, capped at 60s (§6). */
export const createAccessPoller = (): AccessPoller => {
  let generation: AccessStatus | null = null;
  let startedAt = 0;
  let polls = 0;
  let stopped = false;

  return {
    nextInterval(status, now = Date.now()) {
      if (status !== 'PENDING') {
        generation = null;
        polls = 0;
        stopped = false;
        return false;
      }
      if (generation !== status) {
        generation = status;
        startedAt = now;
        polls = 0;
        stopped = false;
      }
      if (stopped || polls >= 12 || now - startedAt >= 60_000) {
        stopped = true;
        return false;
      }
      polls += 1;
      return 5_000;
    },
    exhausted() {
      return stopped;
    },
  };
};