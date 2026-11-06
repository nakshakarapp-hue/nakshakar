import { useEffect } from 'react';
import {
  ArrowLeft,
  Box,
  Check,
  CircleHelp,
  Compass,
  Footprints,
  House,
  IndianRupee,
  Keyboard,
  LayoutGrid,
  Menu,
  MousePointer2,
  PaintBucket,
  Plus,
  Printer,
  Redo2,
  Share2,
  Undo2,
} from 'lucide-react';
import { translateText, useT } from '../app/i18n';
import { activeFloor, redoTarget, undoTarget, useApp, type ToolId } from '../app/store';
import type { Floor } from '../core/model/types';
import { CanvasEditor, CATALOG_TOOLS, TOOL_KEYS } from '../editor2d/CanvasEditor';
import { Dialogs } from './dialogs';
import { TOOL_ICONS } from './icons';
import { Inspector } from './Inspector';
import { PaintBar } from './PaintBar';
import { RoomSheet } from './RoomSheet';
import { Tour } from './Tour';
import { pasteClip } from './SelectionActions';
import { shareHouse } from './shareFile';

const TOOL_GROUPS: { title: string; tools: ToolId[] }[] = [
  { title: 'toolgroup.pick', tools: ['select', 'lasso'] },
  { title: 'toolgroup.draw', tools: ['wall', 'rect', 'polygon', 'arc'] },
  { title: 'toolgroup.add', tools: ['door', 'window', 'stair', 'object', 'plant', 'paint'] },
  { title: 'toolgroup.mark', tools: ['dimension', 'label'] },
];

/** Nothing has been put on this floor yet. */
const isEmptyFloor = (f: Floor) =>
  [
    f.walls,
    f.objects,
    f.stairs,
    f.pillars,
    f.plants,
    f.slabs,
    f.beams,
    f.labels,
    f.electrical,
    f.plumbing,
  ].every((list) => !list.length);

const keyOf = (tool: ToolId) => Object.entries(TOOL_KEYS).find(([, id]) => id === tool)?.[0];

/** Adds a tool's keyboard key to its tooltip. */
function keyHint(label: string, tool: ToolId): string {
  const key = keyOf(tool);
  return key ? `${label} (${key.toUpperCase()})` : label;
}

function SavedBadge() {
  const t = useT();
  const at = useApp((s) => s.lastSavedAt);
  if (!at) return null;
  return (
    <span className="saved" data-testid="saved" title={new Date(at).toLocaleTimeString()}>
      <Check size={14} aria-hidden="true" /> {t('editor.saved')}
    </span>
  );
}

const levelLabel = (f: Floor) => {
  if (/terrace/i.test(f.name)) return 'T';
  if (f.levelIndex < 0) return `B${-f.levelIndex}`;
  return f.levelIndex === 0 ? 'G' : String(f.levelIndex);
};

/** The storeys as a small stack, top floor on top, with one tap to change floor or add one. */
function FloorStack({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const floors = useApp((s) => s.project?.floors ?? []);
  const activeId = useApp((s) => s.activeFloorId);
  const lang = useApp((s) => s.prefs.language);
  const store = useApp.getState();
  return (
    <div className="floor-stack" role="group" aria-label={t('menu.floors')}>
      {readOnly ? null : (
        <button
          className="level add"
          data-testid="floor-add"
          title={t('floors.add')}
          aria-label={t('floors.add')}
          onClick={() => store.setDialog('floors')}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      )}
      {[...floors].reverse().map((f) => (
        <button
          key={f.id}
          className={f.id === activeId ? 'level active' : 'level'}
          data-testid={`floor-level-${floors.indexOf(f)}`}
          title={translateText(lang, f.name)}
          aria-label={translateText(lang, f.name)}
          aria-pressed={f.id === activeId}
          onClick={() => store.setFloor(f.id)}
        >
          {levelLabel(f)}
        </button>
      ))}
    </div>
  );
}

export function EditorScreen() {
  const t = useT();
  const project = useApp((s) => s.project);
  const floor = useApp(activeFloor);
  const tool = useApp((s) => s.tool);
  const toolArg = useApp((s) => s.toolArg);
  const history = useApp((s) => s.history);
  const saveError = useApp((s) => s.saveError);
  const lang = useApp((s) => s.prefs.language);
  const clip = useApp((s) => s.clip);
  const selection = useApp((s) => s.selection);
  const dialog = useApp((s) => s.dialog);
  const lastPlace = useApp((s) => s.lastPlace);
  const readOnly = useApp((s) => s.readOnly);
  const tourOpen = useApp((s) => s.tourOpen);
  const tourDone = useApp((s) => s.prefs.tourDone);
  const store = useApp.getState();
  // The guide runs by itself once, on someone's first empty house; after that it is in the menu.
  const projectId = project?.id;
  useEffect(() => {
    const p = useApp.getState().project;
    if (!p || readOnly || tourDone) return;
    if (p.floors.every(isEmptyFloor)) useApp.setState({ tourOpen: true });
  }, [projectId, readOnly, tourDone]);

  if (!project || !floor) return null;

  const canUndo = undoTarget(history, floor.id);
  const canRedo = redoTarget(history, floor.id);
  const again = lastPlace
    ? lastPlace.arg && lastPlace.tool !== 'wall' && lastPlace.tool !== 'pillar'
      ? t(`obj.${lastPlace.arg}`, lastPlace.arg)
      : t(`tool.${lastPlace.tool}`)
    : '';

  return (
    <div className="editor">
      <header className="topbar">
        <button
          className="btn ghost"
          data-testid="back-home"
          aria-label={t('common.back')}
          title={t('common.back')}
          onClick={() => void store.closeProject()}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <button
          className="project-name"
          data-testid="project-name"
          onClick={() => store.setDialog('project')}
        >
          {project.name}
        </button>
        <button
          className="floor-name"
          data-testid="floor-current"
          title={t('menu.floors')}
          onClick={() => store.setDialog('floors')}
        >
          {translateText(lang, floor.name)}
        </button>
        <button
          className="btn ghost"
          data-testid="undo"
          aria-label={t('action.undo')}
          title={
            canUndo ? `${t('action.undo')}: ${translateText(lang, canUndo.name)} (Ctrl+Z)` : t('action.undo')
          }
          disabled={!canUndo}
          onClick={() => store.undo()}
        >
          <Undo2 size={19} aria-hidden="true" />
        </button>
        <button
          className="btn ghost"
          data-testid="redo"
          aria-label={t('action.redo')}
          title={
            canRedo ? `${t('action.redo')}: ${translateText(lang, canRedo.name)} (Ctrl+Y)` : t('action.redo')
          }
          disabled={!canRedo}
          onClick={() => store.redo()}
        >
          <Redo2 size={19} aria-hidden="true" />
        </button>
        <SavedBadge />
        <span className="topbar-spacer" />
        <button
          className="btn ghost desktop-only"
          data-testid="top-menu"
          onClick={() => store.setDialog('more')}
        >
          <Menu size={18} aria-hidden="true" /> {t('nav.menu')}
        </button>
        <button
          className="btn ghost desktop-only"
          data-testid="show-shortcuts"
          aria-label={t('shortcuts.title')}
          title={`${t('shortcuts.title')} (?)`}
          onClick={() => store.setDialog('shortcuts')}
        >
          <Keyboard size={19} aria-hidden="true" />
        </button>
        <button className="btn desktop-only" data-testid="go-share" onClick={() => void shareHouse(project)}>
          <Share2 size={16} aria-hidden="true" /> {t('shared.share')}
        </button>
        <button className="btn desktop-only" data-testid="go-vastu" onClick={() => store.go('vastu')}>
          <Compass size={16} aria-hidden="true" /> {t('menu.vastu')}
        </button>
        <button className="btn desktop-only" data-testid="go-estimate" onClick={() => store.go('estimate')}>
          <IndianRupee size={16} aria-hidden="true" /> {t('menu.estimate')}
        </button>
        <button className="btn desktop-only" data-testid="go-print" onClick={() => store.go('print')}>
          <Printer size={16} aria-hidden="true" /> {t('menu.print')}
        </button>
        <button className="btn desktop-only" data-testid="go-3d" onClick={() => store.go('view3d')}>
          <Box size={16} aria-hidden="true" /> 3D
        </button>
        <button
          className="btn primary desktop-only"
          data-testid="go-explore"
          onClick={() => store.go('explore')}
        >
          <Footprints size={16} aria-hidden="true" /> {t('nav.explore')}
        </button>
      </header>
      {readOnly ? (
        <div className="shared-banner" data-testid="shared-banner" role="status">
          <span>{t('shared.viewing')}</span>
          <button className="btn primary" data-testid="shared-keep" onClick={() => void store.saveShared()}>
            {t('shared.save')}
          </button>
        </div>
      ) : null}
      {saveError ? (
        <div className="banner error" role="alert">
          {t('editor.saveFailed')}: {saveError}
        </div>
      ) : null}
      {tourOpen && !readOnly ? <Tour onEnd={() => useApp.setState({ tourOpen: false })} /> : null}
      <div className="workspace">
        <nav className="toolrail" hidden={readOnly} aria-label={t('editor.tools')}>
          <button
            className="btn primary rail-rooms"
            data-testid="tool-rooms"
            onClick={() => store.setDialog('rooms')}
          >
            <Plus size={16} aria-hidden="true" /> {t('rooms.title')}
          </button>
          {TOOL_GROUPS.map((group) => (
            <div className="tool-group" key={group.title}>
              <span className="tool-group-title">{t(group.title)}</span>
              {group.tools.map((id) => {
                const Icon = TOOL_ICONS[id];
                return (
                  <button
                    key={id}
                    className={tool === id ? 'tool active' : 'tool'}
                    data-testid={`tool-${id}`}
                    title={keyHint(t(`tool.${id}`), id)}
                    aria-label={t(`tool.${id}`)}
                    aria-pressed={tool === id}
                    onClick={() => {
                      store.setTool(id);
                      if (CATALOG_TOOLS.includes(id)) store.setDialog('catalog');
                    }}
                  >
                    {Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
                    <span className="tool-label">{t(`tool.${id}`)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="tool-group">
            <button
              className="tool"
              data-testid="tool-all"
              title={t('tool.all')}
              onClick={() => {
                store.setTool('select');
                store.setDialog('catalog');
              }}
            >
              <LayoutGrid size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className="tool-label">{t('tool.all')}</span>
            </button>
          </div>
        </nav>
        <main className="stage">
          <CanvasEditor />
          <FloorStack readOnly={readOnly} />
          <ToolHint tool={tool} arg={toolArg} />

          {tool === 'paint' ? (
            <div className="paint-panel" data-testid="paint-panel">
              <PaintBar />
              <button
                className="btn primary paint-done"
                data-testid="paint-done"
                onClick={() => store.setTool('select')}
              >
                {t('common.done')}
              </button>
            </div>
          ) : null}
          {lastPlace && tool === 'select' && dialog !== 'rooms' ? (
            <button
              className="btn add-another"
              data-testid="add-another"
              onClick={() => store.setTool(lastPlace.tool, lastPlace.arg)}
            >
              <Plus size={16} aria-hidden="true" /> {t('add.another')}: {again}
            </button>
          ) : null}
          {tool === 'select' && !selection.length && dialog !== 'rooms' ? (
            <div className="stage-go">
              <button className="btn" data-testid="fab-3d" onClick={() => store.go('view3d')}>
                <Box size={16} aria-hidden="true" /> 3D
              </button>
              <button className="btn primary" data-testid="fab-explore" onClick={() => store.go('explore')}>
                <Footprints size={16} aria-hidden="true" /> {t('nav.explore')}
              </button>
            </div>
          ) : null}
          {clip && !selection.length ? (
            <button className="btn primary paste-here" data-testid="paste-here" onClick={pasteClip}>
              {t('action.paste')}
            </button>
          ) : null}
        </main>
        {readOnly ? null : dialog === 'rooms' ? (
          <RoomSheet onClose={() => store.setDialog(null)} />
        ) : (
          <Inspector />
        )}
      </div>
      <nav className={readOnly ? 'bottom-nav read-only' : 'bottom-nav'} aria-label={t('editor.tools')}>
        <button
          className={dialog === 'rooms' ? 'nav-btn active' : 'nav-btn'}
          data-testid="nav-rooms"
          onClick={() => store.setDialog('rooms')}
        >
          <House size={21} strokeWidth={1.75} aria-hidden="true" />
          {t('nav.rooms')}
        </button>
        <button
          className={dialog === 'catalog' ? 'nav-btn active' : 'nav-btn'}
          data-testid="nav-add"
          onClick={() => store.setDialog('catalog')}
        >
          <Plus size={21} strokeWidth={1.75} aria-hidden="true" />
          {t('nav.add')}
        </button>
        <button
          className={tool === 'paint' ? 'nav-btn active' : 'nav-btn'}
          data-testid="nav-paint"
          onClick={() => store.setTool(tool === 'paint' ? 'select' : 'paint')}
        >
          <PaintBucket size={21} strokeWidth={1.75} aria-hidden="true" />
          {t('tool.paint')}
        </button>
        <button
          className={tool === 'select' && !dialog ? 'nav-btn active' : 'nav-btn'}
          data-testid="nav-select"
          onClick={() => store.setTool('select')}
        >
          <MousePointer2 size={21} strokeWidth={1.75} aria-hidden="true" />
          {t('nav.select')}
        </button>
        <button
          className={dialog === 'more' ? 'nav-btn active' : 'nav-btn'}
          data-testid="nav-more"
          onClick={() => store.setDialog('more')}
        >
          <Menu size={21} strokeWidth={1.75} aria-hidden="true" />
          {t('nav.more')}
        </button>
      </nav>
      <Dialogs />
    </div>
  );
}

function ToolHint({ tool, arg }: { tool: ToolId; arg: string }) {
  const t = useT();
  if (tool === 'select') return null;
  const needsArg = [
    'door',
    'window',
    'stair',
    'object',
    'plant',
    'pillar',
    'electrical',
    'plumbing',
  ].includes(tool);
  return (
    <div className="tool-hint" data-testid="tool-hint">
      <CircleHelp size={14} aria-hidden="true" />
      <span>
        {t(`hint.${tool}`)}
        {needsArg && arg ? ` (${t(`obj.${arg}`, arg)})` : ''}
      </span>
    </div>
  );
}
