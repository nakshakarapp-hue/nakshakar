import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerDownRight,
  Equal,
  FlipHorizontal,
  Lock,
  MousePointerClick,
  RotateCw,
  Ruler,
  Scissors,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { useT } from '../app/i18n';
import { activeFloor, useApp } from '../app/store';
import { bbox } from '../core/geometry/polygon';
import { wallLength } from '../core/geometry/wallGraph';
import {
  copyItems,
  deleteItems,
  deleteRoom,
  findItem,
  makeEqual,
  makeParallel,
  makePerpendicular,
  mirrorItems,
  offsetWall,
  pasteItems,
  rotateItems,
  splitWall,
} from '../editor2d/commands';
import { anchorOf } from '../editor2d/hit';

/** Pastes the copied items on the active floor and selects them. */
export function pasteClip(): void {
  const s = useApp.getState();
  const floor = activeFloor(s);
  const clip = s.clip;
  if (!clip || !floor) return;
  let refs: ReturnType<typeof pasteItems> = [];
  // Pasting on the floor it came from nudges the copy so it can be seen; other floors keep the position.
  const source = clip.items.some((i) => floor.walls.some((w) => w.id === (i.data as { id: string }).id));
  s.commitFloor(
    'Paste',
    (f) => {
      refs = pasteItems(f, clip, source ? { x: 500, y: 500 } : { x: 0, y: 0 });
    },
    true,
  );
  s.setSelection(refs);
}

/** Group actions for whatever is selected: shared by the selection bar and the long-press menu. */
export function SelectionActions({ vertical }: { vertical?: boolean }) {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const clip = useApp((s) => s.clip);
  const floor = useApp(activeFloor);
  const project = useApp((s) => s.project);
  const multiSelect = useApp((s) => s.multiSelect);

  const del = () => {
    const s = useApp.getState();
    if (!s.selection.length) return;
    const current = activeFloor(s);
    if (!current || current.locked) {
      s.showToast(t('editor.floorLocked'));
      return;
    }
    const refs = s.selection.filter((r) => !findItem<{ locked?: boolean }>(current, r)?.locked);
    if (refs.length < s.selection.length) s.showToast(t('action.lockedKept'));
    if (!refs.length) return;
    if (refs.some((r) => r.kind === 'wall' && findItem<{ loadBearing?: boolean }>(current, r)?.loadBearing))
      s.showToast(t('action.loadBearingWarning'));
    s.commitFloor(
      refs.length > 1
        ? `Delete ${refs.length} items`
        : refs[0].kind === 'room'
          ? 'Delete room'
          : 'Delete item',
      (f) => {
        refs.filter((r) => r.kind === 'room').forEach((r) => deleteRoom(f, r.id));
        deleteItems(f, refs);
      },
      true,
    );
    s.setSelection([]);
  };

  useEffect(() => {
    window.addEventListener('gn-delete', del);
    return () => window.removeEventListener('gn-delete', del);
  });

  if (!floor || !project) return null;
  const has = selection.length > 0;
  const center = () => {
    const pts = selection.flatMap((r) => anchorOf(floor, r.kind, r.id));
    const b = bbox(pts.length ? pts : [{ x: 0, y: 0 }]);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };
  const single = selection.length === 1 ? selection[0] : null;
  const wallRefs = selection.filter((r) => r.kind === 'wall');
  const pair = wallRefs.length === 2 && selection.length === 2;
  const lockable = single && findItem<{ locked?: boolean }>(floor, single);

  const Btn = ({
    id,
    label,
    Icon,
    onClick,
    disabled,
    on,
    danger,
  }: {
    id: string;
    label: string;
    Icon: LucideIcon;
    onClick: () => void;
    disabled?: boolean;
    on?: boolean;
    danger?: boolean;
  }) =>
    vertical ? (
      <button className="btn menu-item" data-testid={`action-${id}`} onClick={onClick} disabled={disabled}>
        <Icon size={16} aria-hidden="true" /> {label}
      </button>
    ) : (
      <button
        className={`act${on ? ' on' : ''}${danger ? ' danger' : ''}`}
        data-testid={`action-${id}`}
        title={label}
        aria-label={label}
        aria-pressed={on}
        onClick={onClick}
        disabled={disabled}
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  const touch = navigator.maxTouchPoints > 0;

  return (
    <>
      {has && (vertical || touch) ? (
        <Btn
          id="tap-to-add"
          Icon={MousePointerClick}
          on={multiSelect}
          label={t('action.tapToAdd')}
          onClick={() => useApp.setState({ multiSelect: !multiSelect })}
        />
      ) : null}
      {has && vertical ? (
        <Btn
          id="properties"
          Icon={SlidersHorizontal}
          label={t('action.properties')}
          onClick={() => useApp.getState().setInspector(true)}
        />
      ) : null}
      {has ? (
        <Btn
          id="copy"
          Icon={Copy}
          label={t('action.copy')}
          onClick={() => {
            useApp.getState().setClip(copyItems(floor, selection));
            useApp.getState().showToast(t('action.copied'));
          }}
        />
      ) : null}
      <Btn id="paste" Icon={ClipboardPaste} label={t('action.paste')} disabled={!clip} onClick={pasteClip} />
      {has ? <Btn id="delete" Icon={Trash2} danger label={t('action.delete')} onClick={del} /> : null}
      {has ? (
        <Btn
          id="rotate"
          Icon={RotateCw}
          label={t('action.rotate')}
          onClick={() => {
            const c = center();
            useApp.getState().commitFloor('Rotate 90°', (f) => rotateItems(f, selection, 90, c), true);
          }}
        />
      ) : null}
      {has ? (
        <Btn
          id="mirror"
          Icon={FlipHorizontal}
          label={t('action.mirror')}
          onClick={() => {
            const c = center();
            useApp.getState().commitFloor('Mirror', (f) => mirrorItems(f, selection, c), true);
          }}
        />
      ) : null}
      {single?.kind === 'wall' ? (
        <Btn
          id="split"
          Icon={Scissors}
          label={t('action.splitMiddle')}
          onClick={() => {
            const wall = floor.walls.find((w) => w.id === single.id);
            if (wall)
              useApp
                .getState()
                .commitFloor('Split wall', (f) => void splitWall(f, wall.id, wallLength(wall) / 2), true);
          }}
        />
      ) : null}
      {single?.kind === 'wall' ? (
        <Btn
          id="offset"
          Icon={CopyPlus}
          label={t('action.offsetCopy')}
          onClick={() =>
            useApp.getState().commitFloor('Offset wall', (f) => void offsetWall(f, single.id, 1000), true)
          }
        />
      ) : null}
      {lockable && single?.kind !== 'room' ? (
        <Btn
          id="lock"
          Icon={Lock}
          label={lockable.locked ? t('action.unlock') : t('action.lock')}
          onClick={() =>
            useApp.getState().commitFloor(lockable.locked ? 'Unlock' : 'Lock', (f) => {
              const it = findItem<{ locked?: boolean }>(f, single!);
              if (it) it.locked = !it.locked;
            })
          }
        />
      ) : null}
      {pair ? (
        <>
          <Btn
            id="parallel"
            Icon={Equal}
            label={t('action.makeParallel')}
            onClick={() =>
              useApp
                .getState()
                .commitFloor('Make parallel', (f) => makeParallel(f, wallRefs[1].id, wallRefs[0].id), true)
            }
          />
          <Btn
            id="perpendicular"
            Icon={CornerDownRight}
            label={t('action.makePerpendicular')}
            onClick={() =>
              useApp
                .getState()
                .commitFloor(
                  'Make perpendicular',
                  (f) => makePerpendicular(f, wallRefs[1].id, wallRefs[0].id),
                  true,
                )
            }
          />
          <Btn
            id="equal"
            Icon={Ruler}
            label={t('action.makeEqual')}
            onClick={() =>
              useApp
                .getState()
                .commitFloor('Make equal', (f) => makeEqual(f, wallRefs[1].id, wallRefs[0].id), true)
            }
          />
        </>
      ) : null}
    </>
  );
}
