/**
 * Starting unit rates in rupees. These are editable planning defaults chosen by the app's authors,
 * not quotes or live market prices. Prices vary widely by city and season, so the estimate screen
 * prompts the user to replace them with local rates and always says which rates are still defaults.
 */
export interface RateDef {
  key: string;
  label: string;
  unit: string;
  value: number;
  group: 'Materials' | 'Labour' | 'Finishes' | 'Openings' | 'Services' | 'Interiors';
}

export const RATE_DEFS: RateDef[] = [
  { key: 'cement', label: 'Cement', unit: 'bag', value: 400, group: 'Materials' },
  { key: 'steel', label: 'Reinforcement steel', unit: 'kg', value: 72, group: 'Materials' },
  { key: 'sand', label: 'Sand', unit: 'cu m', value: 2200, group: 'Materials' },
  { key: 'aggregate', label: 'Coarse aggregate', unit: 'cu m', value: 1800, group: 'Materials' },
  { key: 'red_brick', label: 'Red brick', unit: 'each', value: 10, group: 'Materials' },
  { key: 'fly_ash_brick', label: 'Fly ash brick', unit: 'each', value: 8, group: 'Materials' },
  { key: 'aac_block', label: 'AAC block (600 x 200 x 200)', unit: 'each', value: 95, group: 'Materials' },
  {
    key: 'concrete_block',
    label: 'Concrete block (400 x 200 x 200)',
    unit: 'each',
    value: 48,
    group: 'Materials',
  },
  { key: 'stone', label: 'Stone masonry', unit: 'cu m', value: 3000, group: 'Materials' },
  { key: 'mud_brick', label: 'Mud brick', unit: 'each', value: 6, group: 'Materials' },
  { key: 'formwork', label: 'Formwork (shuttering)', unit: 'sq m', value: 420, group: 'Materials' },
  { key: 'labour_excavation', label: 'Excavation labour', unit: 'cu m', value: 450, group: 'Labour' },
  { key: 'labour_rcc', label: 'Concreting labour', unit: 'cu m', value: 1600, group: 'Labour' },
  { key: 'labour_steel', label: 'Bar bending labour', unit: 'kg', value: 11, group: 'Labour' },
  { key: 'labour_masonry', label: 'Masonry labour', unit: 'cu m', value: 1500, group: 'Labour' },
  { key: 'labour_plaster', label: 'Plastering labour', unit: 'sq m', value: 170, group: 'Labour' },
  { key: 'labour_tile', label: 'Tiling labour', unit: 'sq m', value: 300, group: 'Labour' },
  { key: 'labour_paint', label: 'Painting labour', unit: 'sq m', value: 65, group: 'Labour' },
  { key: 'tile', label: 'Floor tile', unit: 'sq m', value: 750, group: 'Finishes' },
  { key: 'tile_wet', label: 'Bathroom and dado tile', unit: 'sq m', value: 650, group: 'Finishes' },
  { key: 'paint_interior', label: 'Interior paint and putty', unit: 'sq m', value: 90, group: 'Finishes' },
  { key: 'paint_exterior', label: 'Exterior paint', unit: 'sq m', value: 110, group: 'Finishes' },
  { key: 'waterproofing', label: 'Waterproofing', unit: 'sq m', value: 350, group: 'Finishes' },
  { key: 'roof_covering', label: 'Sloped roof covering', unit: 'sq m', value: 1100, group: 'Finishes' },
  { key: 'door', label: 'Door with frame', unit: 'sq m', value: 7000, group: 'Openings' },
  { key: 'window', label: 'Window with frame and glass', unit: 'sq m', value: 6000, group: 'Openings' },
  { key: 'grill', label: 'Window grill', unit: 'sq m', value: 1800, group: 'Openings' },
  { key: 'electrical', label: 'Electrical work', unit: 'point', value: 1500, group: 'Services' },
  { key: 'plumbing', label: 'Plumbing and sanitary', unit: 'point', value: 4500, group: 'Services' },
  { key: 'railing', label: 'Stair railing', unit: 'rmt', value: 2800, group: 'Services' },
  { key: 'modular_kitchen', label: 'Modular kitchen', unit: 'rmt', value: 22000, group: 'Interiors' },
  { key: 'wardrobe', label: 'Fitted wardrobe', unit: 'sq m', value: 13000, group: 'Interiors' },
  { key: 'false_ceiling', label: 'False ceiling', unit: 'sq m', value: 1100, group: 'Interiors' },
  { key: 'compound_wall', label: 'Compound wall, all-in', unit: 'rmt', value: 5500, group: 'Materials' },
];

export const rateDefByKey = new Map(RATE_DEFS.map((r) => [r.key, r]));

/** Rate spread around the typed or default price, for price movement and buying differences. */
export const RATE_SPREAD = { min: 0.92, max: 1.12 };

/** Finish-rate multiplier by the chosen quality level. */
export const QUALITY_FACTOR = { economy: 0.8, standard: 1, premium: 1.55 } as const;
