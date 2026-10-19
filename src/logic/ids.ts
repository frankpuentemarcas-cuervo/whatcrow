export const formatId = (id: number): string => `#${id}`;

export function parseId(text: string): number | null {
  const m = /^#?(\d+)$/.exec(text.trim());
  return m ? Number(m[1]) : null;
}
