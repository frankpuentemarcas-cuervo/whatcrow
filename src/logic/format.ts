const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const pad = (n: number): string => String(n).padStart(2, '0');

/** Hora en formato 24 h (ui-spec §10). */
export function clock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Hora con segundos, para la barra de estado y el banner de lectura vieja. */
export function clockSeconds(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Texto relativo corto: "hace 3 min", "hace 2 h", "hace 4 d". */
export function relativeAgo(from: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - from) / 60_000));
  if (minutes < 1) return 'hace menos de 1 min';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

/** "mar 20 oct" (ui-spec §5.8). */
export function dayMonth(ts: number): string {
  const d = new Date(ts);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "mar 20 oct, 09:00" (ui-spec §5.8). */
export function saleLabel(ts: number): string {
  return `${dayMonth(ts)}, ${clock(ts)}`;
}

/** Fecha para `<input type="date">`, en hora local. */
export function isoDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hora para `<input type="time">`, en hora local. */
export function isoTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Une los dos campos nativos del selector de programación. */
export function fromInputs(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const value = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
    0,
  ).getTime();
  return Number.isFinite(value) ? value : null;
}

export interface SchedulePreset {
  key: string;
  label: string;
  at: number;
}

/**
 * Atajos del selector (ui-spec §5.8). "Hoy 18:00" se omite si ya pasó y
 * "Lunes 09:00" solo aparece de viernes a domingo.
 */
export function schedulePresets(now: number): SchedulePreset[] {
  const today = new Date(now);
  const presets: SchedulePreset[] = [];

  presets.push({ key: 'in-1h', label: 'En 1 h', at: now + 3_600_000 });

  const todayAt18 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0, 0, 0).getTime();
  if (todayAt18 > now) presets.push({ key: 'today-18', label: 'Hoy 18:00', at: todayAt18 });

  const tomorrowAt9 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9, 0, 0, 0).getTime();
  presets.push({ key: 'tomorrow-9', label: 'Mañana 09:00', at: tomorrowAt9 });

  const day = today.getDay();
  const daysToMonday = day === 5 ? 3 : day === 6 ? 2 : day === 0 ? 1 : 0;
  if (daysToMonday > 0) {
    const mondayAt9 = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + daysToMonday,
      9,
      0,
      0,
      0,
    ).getTime();
    presets.push({ key: 'monday-9', label: 'Lunes 09:00', at: mondayAt9 });
  }

  return presets;
}
