import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Sparkles, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { translateText, useT } from '../app/i18n';
import { activeFloor, undoTarget, useApp } from '../app/store';
import type { Id, RoomType } from '../core/model/types';
import { formatLength } from '../core/units';
import { addRoom, placeRoom, ROOM_SIZES, type RoomSide } from '../editor2d/roomAdder';
import { LengthField } from './fields';
import { ROOM_ICONS } from './icons';

const SIDES: [RoomSide, typeof ArrowUp][] = [
  ['left', ArrowLeft],
  ['above', ArrowUp],
  ['below', ArrowDown],
  ['right', ArrowRight],
];

/**
 * Adds room after room. The plan shows where the next room will land before it is added, the panel
 * stays open, and the next room attaches to the last one or to whichever room is tapped.
 */
export function RoomSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useApp((s) => s.prefs.language);
  const unit = useApp((s) => s.project?.settings.displayUnit ?? 'ftin');
  const floor = useApp(activeFloor);
  const rooms = floor?.rooms ?? [];
  const canUndo = useApp((s) => undoTarget(s.history, s.activeFloorId) !== null);
  const picked = useApp((s) => s.selection.find((r) => r.kind === 'room')?.id);
  const [type, setType] = useState<RoomType>('bedroom');
  const sizes = ROOM_SIZES[type] ?? [[3048, 3048]];
  const [width, setWidth] = useState(sizes[1 % sizes.length][0]);
  const [depth, setDepth] = useState(sizes[1 % sizes.length][1]);
  const [side, setSide] = useState<RoomSide>('auto');
  const [door, setDoor] = useState(true);
  const [windowOn, setWindowOn] = useState(true);
  const [furnish, setFurnish] = useState(true);
  const [last, setLast] = useState<Id | undefined>(undefined);
  const [custom, setCustom] = useState(false);

  // Best fit may use any room, unless one is chosen; a set direction continues from the last one.
  const anchorId = picked ?? (side === 'auto' ? undefined : last);
  const anchorName = rooms.find((r) => r.id === (picked ?? last))?.name;
  const label = t(`room.${type}`);

  const choose = (next: RoomType) => {
    setType(next);
    const chips = ROOM_SIZES[next] ?? [[3048, 3048]];
    const [w, d] = chips[1 % chips.length];
    setCustom(false);
    setWidth(w);
    setDepth(d);
  };

  // The dashed outline on the plan: where this room will go if Add is pressed now.
  const walls = floor?.walls;
  useEffect(() => {
    if (!floor) return;
    useApp.getState().setRoomPreview({ box: placeRoom(floor, width, depth, side, anchorId), label });
    return () => useApp.getState().setRoomPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls, rooms.length, width, depth, side, anchorId, label]);

  const add = () => {
    const s = useApp.getState();
    const same = rooms.filter((r) => r.type === type).length;
    const name = same ? `${label} ${same + 1}` : label;
    let made: Id | null = null;
    s.commitFloor(`Add ${name}`, (f, d) => {
      made = addRoom(
        f,
        { type, name, width, depth, side, anchorId, door, window: windowOn, furnish },
        d.settings.northAngleDeg,
      ).roomId;
    });
    if (made) setLast(made);
    useApp.setState({ selection: [] });
    s.requestFit();
    s.showToast(t('rooms.added').replace('{name}', name));
    s.markMilestone('Room added');
  };

  // The panel takes space from the plan, on opening and on closing alike.
  useEffect(() => {
    const id = setTimeout(() => useApp.getState().requestFit(), 60);
    return () => clearTimeout(id);
  }, []);

  // Enter adds the room, unless a box is being typed in.
  const latestAdd = useLatest(add);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const el = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return;
      e.preventDefault();
      latestAdd.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [latestAdd]);

  const fmt = (mm: number) => formatLength(mm, unit, 0);
  const options: [string, boolean, (b: boolean) => void, string][] = [
    ['rooms.door', door, setDoor, 'room-door'],
    ['rooms.window', windowOn, setWindowOn, 'room-window'],
    ['rooms.furnish', furnish, setFurnish, 'room-furnish'],
  ];

  return (
    <aside className="room-sheet" data-testid="room-sheet" aria-label={t('rooms.title')}>
      <header className="room-sheet-head">
        <div>
          <h2>{t('rooms.title')}</h2>
          <p className="muted small">
            {floor ? translateText(lang, floor.name) : ''} ·{' '}
            {t('rooms.count').replace('{n}', String(rooms.length))}
          </p>
        </div>
        <button
          className="btn"
          data-testid="rooms-done"
          onClick={() => {
            onClose();
            useApp.getState().requestFit();
          }}
        >
          {t('common.done')}
        </button>
      </header>

      <div className="room-sheet-body">
        <section>
          <h3>{t('rooms.step.type')}</h3>
          <div className="room-types" data-testid="room-types">
            {ROOM_ICONS.map(([id, Icon]) => (
              <button
                key={id}
                className={type === id ? 'room-type active' : 'room-type'}
                data-testid={`room-type-${id}`}
                aria-pressed={type === id}
                onClick={() => choose(id)}
              >
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                <span>{t(`room.${id}`)}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>{t('rooms.step.size')}</h3>
          <div className="choice-row">
            {sizes.map(([w, d]) => (
              <button
                key={`${w}-${d}`}
                className={!custom && width === w && depth === d ? 'choice active' : 'choice'}
                data-testid={`room-size-${w}-${d}`}
                onClick={() => {
                  setCustom(false);
                  setWidth(w);
                  setDepth(d);
                }}
              >
                {fmt(w)} × {fmt(d)}
              </button>
            ))}
            <button
              className={custom ? 'choice active' : 'choice'}
              data-testid="room-size-custom"
              onClick={() => setCustom(!custom)}
            >
              {t('rooms.customSize')}
            </button>
          </div>
          {custom ? (
            <div className="two-col">
              <LengthField
                label={t('room.width')}
                value={width}
                min={500}
                onCommit={setWidth}
                testId="room-custom-width"
              />
              <LengthField
                label={t('room.depth')}
                value={depth}
                min={500}
                onCommit={setDepth}
                testId="room-custom-depth"
              />
            </div>
          ) : null}
        </section>

        {rooms.length ? (
          <section>
            <h3>{t('rooms.step.where')}</h3>
            <div className="choice-row" role="group" aria-label={t('rooms.where')}>
              <button
                className={side === 'auto' ? 'choice active' : 'choice'}
                data-testid="room-side-auto"
                onClick={() => setSide('auto')}
              >
                <Sparkles size={15} aria-hidden="true" /> {t('rooms.side.auto')}
              </button>
              {SIDES.map(([id, Icon]) => (
                <button
                  key={id}
                  className={side === id ? 'choice icon-only active' : 'choice icon-only'}
                  data-testid={`room-side-${id}`}
                  aria-label={t(`rooms.side.${id}`)}
                  title={t(`rooms.side.${id}`)}
                  onClick={() => setSide(id)}
                >
                  <Icon size={17} aria-hidden="true" />
                </button>
              ))}
            </div>
            <p className="muted small">
              {side !== 'auto' && anchorName
                ? t('rooms.attachTo').replace('{name}', translateText(lang, anchorName))
                : t('rooms.tapRoom')}
            </p>
          </section>
        ) : null}

        <section>
          <h3>{t('rooms.step.include')}</h3>
          <div className="choice-row">
            {options.map(([key, value, set, testId]) => (
              <label key={key} className={value ? 'choice active' : 'choice'}>
                <input
                  data-testid={testId}
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                />
                {value ? <Check size={15} aria-hidden="true" /> : null}
                {t(key)}
              </label>
            ))}
          </div>
        </section>
      </div>

      <footer className="room-sheet-foot">
        <button
          className="btn icon-btn"
          data-testid="room-undo"
          aria-label={t('action.undo')}
          title={t('action.undo')}
          disabled={!canUndo}
          onClick={() => useApp.getState().undo()}
        >
          <Undo2 size={18} aria-hidden="true" />
        </button>
        <button className="btn primary room-add" data-testid="room-add" onClick={add}>
          {t('rooms.add').replace('{name}', label)} · {fmt(width)} × {fmt(depth)}
        </button>
      </footer>
    </aside>
  );
}

function useLatest<T>(value: T) {
  const [box] = useState({ current: value });
  box.current = value;
  return box;
}
