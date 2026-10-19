export type WidthMode = 'narrow' | 'narrow-plus' | 'list-detail' | 'three-col';
export type HeightMode = 'low' | 'medium' | 'tall';

/** Tamaños del control de presets (ui-spec §3.3). */
export const PRESETS = { counter: [184, 48], compact: [330, 440], normal: [330, 660], wide: [760, 660] } as const;

export const widthMode = (w: number): WidthMode =>
  w >= 960 ? 'three-col' : w >= 600 ? 'list-detail' : w >= 380 ? 'narrow-plus' : 'narrow';

export const heightMode = (h: number): HeightMode => (h >= 800 ? 'tall' : h >= 480 ? 'medium' : 'low');

/** Con tarjetas angostas, Programar queda solo como ícono (ui-spec §3.4). */
export const scheduleAsIcon = (cardWidth: number): boolean => cardWidth < 340;
