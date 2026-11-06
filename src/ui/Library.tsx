import {
  AppWindow,
  Armchair,
  Clock3,
  ChevronsUp,
  Columns2,
  DoorOpen,
  Droplet,
  Minus,
  Ruler,
  Search,
  TreePine,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useT } from '../app/i18n';
import { useApp, type ToolId } from '../app/store';
import { OBJECT_CATEGORIES, OBJECTS, OPENING_TYPES, PLANTS, STAIR_TYPES } from '../catalog/catalog';
import { formatLength } from '../core/units';
import { Dialog } from './fields';
import { ELECTRICAL_ICONS, PLUMBING_ICONS, TOOL_ICONS } from './icons';
import { ItemThumb } from './ItemThumb';

type Tab =
  | 'recent'
  | 'walls'
  | 'doors'
  | 'windows'
  | 'stairs'
  | 'furniture'
  | 'plants'
  | 'structure'
  | 'electrical'
  | 'plumbing'
  | 'edit';
type Kind = 'object' | 'opening' | 'stair' | 'plant' | 'wall' | 'pillar';

const TABS: { id: Tab; Icon: LucideIcon }[] = [
  // In the order a house is built: the frame first, then walls and openings, services, then furnishing.
  { id: 'recent', Icon: Clock3 },
  { id: 'structure', Icon: Columns2 },
  { id: 'walls', Icon: Minus },
  { id: 'doors', Icon: DoorOpen },
  { id: 'windows', Icon: AppWindow },
  { id: 'stairs', Icon: ChevronsUp },
  { id: 'electrical', Icon: Zap },
  { id: 'plumbing', Icon: Droplet },
  { id: 'furniture', Icon: Armchair },
  { id: 'plants', Icon: TreePine },
  { id: 'edit', Icon: Ruler },
];

const TOOL_TAB: Partial<Record<ToolId, Tab>> = {
  door: 'doors',
  window: 'windows',
  object: 'furniture',
  plant: 'plants',
  stair: 'stairs',
  pillar: 'structure',
  electrical: 'electrical',
  plumbing: 'plumbing',
};

const WALL_TYPES = ['outer', 'inner', 'compound', 'parapet', 'half', 'retaining', 'glass'];
const DRAW_ITEMS: ToolId[] = ['rect', 'polygon', 'arc'];
const STRUCTURE_ITEMS: ToolId[] = ['beam', 'slab'];
const EDIT_ITEMS: ToolId[] = ['lasso', 'dimension', 'label', 'split', 'offset'];

/** Everything that can be added, in separate sections, each item shown by how it really looks. */
export function Library({ onClose }: { onClose: () => void }) {
  const t = useT();
  const armed = useApp((s) => s.tool);
  const unit = useApp((s) => s.project?.settings.displayUnit ?? 'ftin');
  const [tab, setTab] = useState<Tab>(TOOL_TAB[armed] ?? 'recent');
  const [category, setCategory] = useState(OBJECT_CATEGORIES[0]);
  const [query, setQuery] = useState('');
  const fmt = (mm: number) => formatLength(mm, unit, 0);
  const recents = useApp((s) => s.prefs.recents ?? []);
  const pick = (tool: ToolId, arg = '') => {
    useApp.getState().addRecent({ tool, arg });
    useApp.getState().setTool(tool, arg);
    onClose();
  };

  const toolCard = (tool: ToolId) => {
    const Icon = TOOL_ICONS[tool];
    return (
      <button
        key={tool}
        className="library-card tool-card"
        data-testid={`lib-tool-${tool}`}
        onClick={() => pick(tool)}
      >
        {Icon ? <Icon size={24} strokeWidth={1.5} aria-hidden="true" /> : null}
        <strong>{t(`tool.${tool}`)}</strong>
        <span className="small muted">{t(`hint.${tool}`)}</span>
      </button>
    );
  };
  const pictured = (tool: ToolId, arg: string, kind: Kind, name: string, detail?: string) => (
    <button key={arg} className="library-card" data-testid={`catalog-${arg}`} onClick={() => pick(tool, arg)}>
      <ItemThumb kind={kind} id={arg} />
      <strong>{t(`obj.${arg}`, name)}</strong>
      {detail ? <span className="small muted">{detail}</span> : null}
    </button>
  );
  const simple = (tool: ToolId, arg: string, Icon: LucideIcon, name: string) => (
    <button
      key={arg}
      className="library-card tool-card"
      data-testid={`catalog-${arg}`}
      onClick={() => pick(tool, arg)}
    >
      <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
      <strong>{name}</strong>
    </button>
  );

  const doors = OPENING_TYPES.filter((o) => o.kind === 'door');
  const windows = OPENING_TYPES.filter((o) => o.kind === 'window');
  const opening = (o: (typeof OPENING_TYPES)[number]) =>
    pictured(
      o.kind === 'door' ? 'door' : 'window',
      o.id,
      'opening',
      o.name,
      `${fmt(o.width)} x ${fmt(o.height)}`,
    );
  const object = (o: (typeof OBJECTS)[number]) =>
    pictured('object', o.id, 'object', o.name, `${fmt(o.width)} x ${fmt(o.depth)}`);
  const plant = (o: (typeof PLANTS)[number]) => pictured('plant', o.id, 'plant', o.name, fmt(o.height));
  const stair = (o: (typeof STAIR_TYPES)[number]) => pictured('stair', o.id, 'stair', o.name);

  // Search covers every section, in the language on screen and in English.
  const needle = query.trim().toLowerCase();
  const matches = (o: { id: string; name: string }) =>
    o.name.toLowerCase().includes(needle) || t(`obj.${o.id}`, o.name).toLowerCase().includes(needle);
  let body: ReactNode;
  if (needle) {
    const found = [
      ...OPENING_TYPES.filter(matches).map(opening),
      ...OBJECTS.filter(matches).map(object),
      ...PLANTS.filter(matches).map(plant),
      ...STAIR_TYPES.filter(matches).map(stair),
    ];
    body = found.length ? found : <p className="muted">{t('library.noResults')}</p>;
  } else if (tab === 'recent') {
    const shown = recents.map(({ tool, arg }) => {
      if (tool === 'door' || tool === 'window') {
        const o = OPENING_TYPES.find((x) => x.id === arg);
        return o ? opening(o) : null;
      }
      if (tool === 'object') {
        const o = OBJECTS.find((x) => x.id === arg);
        return o ? object(o) : null;
      }
      if (tool === 'plant') {
        const o = PLANTS.find((x) => x.id === arg);
        return o ? plant(o) : null;
      }
      if (tool === 'stair') {
        const o = STAIR_TYPES.find((x) => x.id === arg);
        return o ? stair(o) : null;
      }
      if (tool === 'wall' && arg) return pictured('wall', arg, 'wall', t(`walltype.${arg}`));
      if (tool === 'pillar') return pictured('pillar', arg || 'rect', 'pillar', t(`pillar.${arg || 'rect'}`));
      if (tool === 'electrical') {
        const hit = ELECTRICAL_ICONS.find(([id]) => id === arg);
        return hit ? simple('electrical', arg, hit[1], t(`electrical.${arg}`)) : null;
      }
      if (tool === 'plumbing') {
        const hit = PLUMBING_ICONS.find(([id]) => id === arg);
        return hit ? simple('plumbing', arg, hit[1], t(`plumbing.${arg}`)) : null;
      }
      return toolCard(tool);
    });
    body = shown.length ? (
      shown
    ) : (
      <p className="muted library-empty" data-testid="recent-empty">
        {t('library.recentEmpty')}
      </p>
    );
  } else if (tab === 'doors') body = doors.map(opening);
  else if (tab === 'windows') body = windows.map(opening);
  else if (tab === 'stairs') body = STAIR_TYPES.map(stair);
  else if (tab === 'plants') body = PLANTS.map(plant);
  else if (tab === 'furniture') body = OBJECTS.filter((o) => o.category === category).map(object);
  else if (tab === 'walls')
    body = [
      ...WALL_TYPES.map((id) => pictured('wall', id, 'wall', t(`walltype.${id}`))),
      ...DRAW_ITEMS.map(toolCard),
    ];
  else if (tab === 'structure')
    body = [
      pictured('pillar', 'rect', 'pillar', t('pillar.rect')),
      pictured('pillar', 'round', 'pillar', t('pillar.round')),
      ...STRUCTURE_ITEMS.map(toolCard),
    ];
  else if (tab === 'electrical')
    body = ELECTRICAL_ICONS.map(([id, Icon]) => simple('electrical', id, Icon, t(`electrical.${id}`)));
  else if (tab === 'plumbing')
    body = PLUMBING_ICONS.map(([id, Icon]) => simple('plumbing', id, Icon, t(`plumbing.${id}`)));
  else body = EDIT_ITEMS.map(toolCard);

  return (
    <Dialog title={t('library.title')} onClose={onClose} wide>
      <label className="search-box">
        <Search size={16} aria-hidden="true" />
        <input
          className="input"
          data-testid="library-search"
          type="search"
          placeholder={t('library.search')}
          aria-label={t('library.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {needle ? null : (
        <div className="tabs library-tabs" role="tablist" data-testid="library-tabs">
          {TABS.map(({ id, Icon }) => (
            <button
              key={id}
              className={tab === id ? 'tab active' : 'tab'}
              data-testid={`lib-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" /> {t(`library.${id}`)}
            </button>
          ))}
        </div>
      )}

      {tab === 'furniture' && !needle ? (
        <div className="choice-row scroll">
          {OBJECT_CATEGORIES.map((c) => (
            <button
              key={c}
              className={c === category ? 'choice active' : 'choice'}
              onClick={() => setCategory(c)}
            >
              {t(`category.${c}`, c)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="library-grid">{body}</div>
    </Dialog>
  );
}
