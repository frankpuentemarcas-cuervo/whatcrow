import { describe, expect, it } from 'vitest';
import {
  clock,
  clockSeconds,
  fromInputs,
  isoDate,
  isoTime,
  relativeAgo,
  saleLabel,
  schedulePresets,
} from './format';

describe('format (ui-spec §5.5, §5.8 y §10)', () => {
  const ts = new Date(2026, 9, 19, 10, 42, 15).getTime();

  it('horas en 24 h con cifras tabulares', () => {
    expect(clock(ts)).toBe('10:42');
    expect(clockSeconds(ts)).toBe('10:42:15');
  });

  it('texto relativo', () => {
    expect(relativeAgo(ts, ts)).toBe('hace menos de 1 min');
    expect(relativeAgo(ts, ts + 3 * 60_000)).toBe('hace 3 min');
    expect(relativeAgo(ts, ts + 2 * 3_600_000)).toBe('hace 2 h');
    expect(relativeAgo(ts, ts + 4 * 86_400_000)).toBe('hace 4 d');
  });

  it('etiqueta de programación y campos nativos', () => {
    const at = new Date(2026, 9, 20, 9, 0).getTime();
    expect(saleLabel(at)).toBe('mar 20 oct, 09:00');
    expect(isoDate(at)).toBe('2026-10-20');
    expect(isoTime(at)).toBe('09:00');
    expect(fromInputs('2026-10-20', '09:00')).toBe(at);
    expect(fromInputs('2026-10-20', '')).toBeNull();
    expect(fromInputs('', '09:00')).toBeNull();
  });

  it('atajos de programación', () => {
    const fridayNoon = new Date(2026, 9, 23, 12, 0).getTime();
    const friday = schedulePresets(fridayNoon);
    expect(friday.map((p) => p.label)).toEqual(['En 1 h', 'Hoy 18:00', 'Mañana 09:00', 'Lunes 09:00']);
    expect(friday.map((p) => p.at)).toEqual([
      fridayNoon + 3_600_000,
      new Date(2026, 9, 23, 18, 0).getTime(),
      new Date(2026, 9, 24, 9, 0).getTime(),
      new Date(2026, 9, 26, 9, 0).getTime(),
    ]);

    const mondayMorning = new Date(2026, 9, 19, 10, 0).getTime();
    expect(schedulePresets(mondayMorning).map((p) => p.label)).toEqual(['En 1 h', 'Hoy 18:00', 'Mañana 09:00']);

    const mondayEvening = new Date(2026, 9, 19, 19, 0).getTime();
    expect(schedulePresets(mondayEvening).map((p) => p.label)).toEqual(['En 1 h', 'Mañana 09:00']);
  });
});
