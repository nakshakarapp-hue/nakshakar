import {
  Building2,
  Calculator,
  Compass,
  Eraser,
  History,
  IndianRupee,
  Keyboard,
  LandPlot,
  Layers,
  Magnet,
  Map,
  PencilRuler,
  Printer,
  Save,
  Settings,
  Shapes,
  Share2,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '../app/i18n';
import { useApp, type DialogId, type Screen } from '../app/store';
import { Dialog } from './fields';
import { shareHouse } from './shareFile';

const REPORTS: [Screen, LucideIcon, string][] = [
  ['vastu', Compass, 'menu.vastu'],
  ['estimate', IndianRupee, 'menu.estimate'],
  ['print', Printer, 'menu.print'],
];

const GROUPS: [string, [DialogId, LucideIcon, string][]][] = [
  [
    'more.build',
    [
      ['wizard', Shapes, 'menu.wizard'],
      ['perimeter', PencilRuler, 'menu.perimeter'],
      ['plot', LandPlot, 'menu.plot'],
    ],
  ],
  [
    'more.project',
    [
      ['floors', Building2, 'menu.floors'],
      ['site', Map, 'menu.site'],
      ['materials', Eraser, 'menu.materials'],
      ['versions', Save, 'menu.versions'],
      ['history', History, 'menu.history'],
    ],
  ],
  [
    'more.preferences',
    [
      ['layers', Layers, 'menu.layers'],
      ['snap', Magnet, 'menu.snap'],
      ['converter', Calculator, 'menu.converter'],
      ['settings', Settings, 'menu.settings'],
      ['shortcuts', Keyboard, 'shortcuts.title'],
    ],
  ],
];

/** Everything that is not drawing, in one grouped list, so the main screen stays clear. */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const store = useApp.getState();
  return (
    <Dialog title={t('nav.menu')} onClose={onClose}>
      <div className="menu-list">
        <button
          className="menu-row tour-row"
          data-testid="more-tour"
          onClick={() => {
            onClose();
            useApp.setState({ tourOpen: true });
          }}
        >
          <GraduationCap size={18} aria-hidden="true" />
          <span>{t('tour.again')}</span>
        </button>
        <section className="reports-only">
          <h3 className="section-title">{t('more.reports')}</h3>
          {REPORTS.map(([id, Icon, key]) => (
            <button
              key={id}
              className="menu-row"
              data-testid={`more-${id}`}
              onClick={() => {
                onClose();
                store.go(id);
              }}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {t(key)}
            </button>
          ))}
        </section>
        <section>
          <h3 className="section-title">{t('shared.share')}</h3>
          <button
            className="menu-row"
            data-testid="more-share"
            onClick={() => {
              onClose();
              const open = useApp.getState().project;
              if (open) void shareHouse(open);
            }}
          >
            <Share2 size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('shared.shareFile')}
          </button>
        </section>
        {GROUPS.map(([title, items]) => (
          <section key={title}>
            <h3 className="section-title">{t(title)}</h3>
            {items.map(([id, Icon, key]) => (
              <button
                key={id}
                className="menu-row"
                data-testid={`more-${id}`}
                onClick={() => store.setDialog(id)}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {t(key)}
              </button>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
