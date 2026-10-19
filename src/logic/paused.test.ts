import { describe, expect, it } from 'vitest';
import { isPaused } from './paused';

describe('isPaused', () => {
  it('pausa sin lectura o con lectura de más de 10 s', () => {
    expect(isPaused(null, 1_000)).toBe(true);
    expect(isPaused(0, 10_000)).toBe(false);
    expect(isPaused(0, 10_001)).toBe(true);
  });
});
