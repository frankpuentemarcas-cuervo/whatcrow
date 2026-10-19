import { describe, expect, it } from 'vitest';
import { heightMode, scheduleAsIcon, widthMode } from './layout';

describe('layout (ui-spec §3.3 y §3.4)', () => {
  it('breakpoints de ancho', () => {
    expect([300, 379, 380, 599, 600, 959, 960].map(widthMode)).toEqual([
      'narrow', 'narrow', 'narrow-plus', 'narrow-plus', 'list-detail', 'list-detail', 'three-col',
    ]);
  });
  it('breakpoints de alto', () => {
    expect([360, 479, 480, 799, 800].map(heightMode)).toEqual(['low', 'low', 'medium', 'medium', 'tall']);
  });
  it('Programar pasa a ícono con tarjeta de menos de 340 px', () => {
    expect([267, 339, 340].map(scheduleAsIcon)).toEqual([true, true, false]);
  });
});
