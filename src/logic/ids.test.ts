import { describe, expect, it } from 'vitest';
import { formatId, parseId } from './ids';

describe('ids', () => {
  it('formato corto y parseo tolerante', () => {
    expect(formatId(142)).toBe('#142');
    expect(['#142', '142', ' #142 ', '#x', ''].map(parseId)).toEqual([142, 142, 142, null, null]);
  });
});
