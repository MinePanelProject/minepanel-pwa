import { describe, expect, it } from 'vitest';
import { isSystemStats } from '@/api/types';

describe('system.stats payload validation', () => {
  it('accepts only finite non-negative telemetry fields before a socket handler can render them', () => {
    expect(
      isSystemStats({ totalRamMb: 16_384, usedRamMb: 4_096, freeDiskMb: 512_000, cpuCount: 8 }),
    ).toBe(true);

    expect(isSystemStats({ totalRamMb: Number.NaN, usedRamMb: 1, freeDiskMb: 1, cpuCount: 1 })).toBe(false);
    expect(isSystemStats({ totalRamMb: 1, usedRamMb: -1, freeDiskMb: 1, cpuCount: 1 })).toBe(false);
    expect(isSystemStats({ totalRamMb: 1, usedRamMb: 1, freeDiskMb: 1 })).toBe(false);
    expect(isSystemStats({ totalRamMb: '1', usedRamMb: 1, freeDiskMb: 1, cpuCount: 1 })).toBe(false);
  });
});
