/** A paint chart in plain names, grouped the way people choose paint. */
export interface Paint {
  id: string;
  name: string;
  hex: string;
}

export const PAINTS: Paint[] = [
  { id: 'white', name: 'Pure white', hex: '#fbfaf5' },
  { id: 'cream', name: 'Cream', hex: '#f6ecd9' },
  { id: 'ivory', name: 'Ivory', hex: '#efe6cf' },
  { id: 'sand', name: 'Sand', hex: '#e2d3b5' },
  { id: 'peach', name: 'Peach', hex: '#f7cfae' },
  { id: 'coral', name: 'Coral', hex: '#ee8d72' },
  { id: 'terracotta', name: 'Terracotta', hex: '#b85c3e' },
  { id: 'brick', name: 'Brick red', hex: '#8e3b2e' },
  { id: 'rose', name: 'Rose pink', hex: '#ee9fb5' },
  { id: 'hot_pink', name: 'Hot pink', hex: '#e84d8a' },
  { id: 'lilac', name: 'Lilac', hex: '#c9b6e4' },
  { id: 'violet', name: 'Royal violet', hex: '#6a4c93' },
  { id: 'sky', name: 'Sky blue', hex: '#a8d4ec' },
  { id: 'teal', name: 'Teal', hex: '#2a8d8f' },
  { id: 'navy', name: 'Navy', hex: '#1f3a5f' },
  { id: 'mint', name: 'Mint', hex: '#bfe5cc' },
  { id: 'sage', name: 'Sage green', hex: '#9db59a' },
  { id: 'olive', name: 'Olive', hex: '#6f7c3f' },
  { id: 'lemon', name: 'Lemon', hex: '#f5e88f' },
  { id: 'mustard', name: 'Mustard', hex: '#d9a521' },
  { id: 'grey', name: 'Soft grey', hex: '#c9cdd1' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3c4248' },
  { id: 'walnut', name: 'Walnut', hex: '#5d3a1f' },
  { id: 'black', name: 'Black', hex: '#1b1d20' },
];

export type PaintTarget = 'walls' | 'floor' | 'ceiling' | 'outside';
