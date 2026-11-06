import { Check } from 'lucide-react';
import { useT } from '../app/i18n';
import { activeFloor, useApp } from '../app/store';
import type {
  Beam,
  Floor,
  Opening,
  Pillar,
  PlacedObject,
  Plant,
  Room,
  Slab,
  Stair,
} from '../core/model/types';
import { bbox } from '../core/geometry/polygon';
import { findItem, setRoomSize, setSlabSize, type ItemRef } from '../editor2d/commands';
import { LengthField } from './fields';

export interface SizeField {
  label: string;
  value: number;
  min: number;
  name: string;
  set(floor: Floor, v: number): void;
}

/** The sizes of an item, in one place, whatever kind of item it is. */
export function sizeFields(floor: Floor, ref: ItemRef): SizeField[] {
  const on =
    <T,>(key: keyof T) =>
    (f: Floor, v: number) => {
      const k = findItem<T>(f, ref);
      if (k) (k as Record<keyof T, unknown>)[key] = v;
    };
  switch (ref.kind) {
    case 'object':
    case 'pillar': {
      const o = findItem<PlacedObject | Pillar>(floor, ref);
      if (!o) return [];
      const name = ref.kind === 'object' ? 'Resize object' : 'Change pillar';
      return [
        { label: 'object.width', value: o.width, min: 10, name, set: on<PlacedObject>('width') },
        { label: 'object.depth', value: o.depth, min: 10, name, set: on<PlacedObject>('depth') },
        { label: 'object.height', value: o.height, min: 10, name, set: on<PlacedObject>('height') },
      ];
    }
    case 'stair': {
      const s = findItem<Stair>(floor, ref);
      if (!s) return [];
      return [
        {
          label: 'stair.width',
          value: s.width,
          min: 500,
          name: 'Change stair width',
          set: on<Stair>('width'),
        },
        {
          label: 'stair.totalRise',
          value: s.totalRise,
          min: 300,
          name: 'Change rise',
          set: on<Stair>('totalRise'),
        },
        { label: 'stair.tread', value: s.tread, min: 150, name: 'Change tread', set: on<Stair>('tread') },
        { label: 'stair.riser', value: s.riser, min: 100, name: 'Change riser', set: on<Stair>('riser') },
      ];
    }
    case 'plant': {
      const p = findItem<Plant>(floor, ref);
      if (!p) return [];
      return [
        { label: 'plant.spread', value: p.spread, min: 50, name: 'Resize plant', set: on<Plant>('spread') },
        { label: 'object.height', value: p.height, min: 10, name: 'Resize plant', set: on<Plant>('height') },
      ];
    }
    case 'opening': {
      const o = findItem<Opening>(floor, ref);
      if (!o) return [];
      return [
        {
          label: 'object.width',
          value: o.width,
          min: 100,
          name: 'Change opening width',
          set: on<Opening>('width'),
        },
        {
          label: 'object.height',
          value: o.height,
          min: 100,
          name: 'Change opening height',
          set: on<Opening>('height'),
        },
      ];
    }
    case 'beam': {
      const b = findItem<Beam>(floor, ref);
      if (!b) return [];
      return [
        { label: 'object.width', value: b.width, min: 50, name: 'Change beam', set: on<Beam>('width') },
        { label: 'object.height', value: b.depth, min: 50, name: 'Change beam', set: on<Beam>('depth') },
      ];
    }
    case 'slab': {
      const s = findItem<Slab>(floor, ref);
      if (!s) return [];
      const b = bbox(s.polygon);
      return [
        {
          label: 'room.width',
          value: b.maxX - b.minX,
          min: 100,
          name: 'Change slab',
          set: (f, v) => setSlabSize(f, ref.id, 'x', v),
        },
        {
          label: 'room.depth',
          value: b.maxY - b.minY,
          min: 100,
          name: 'Change slab',
          set: (f, v) => setSlabSize(f, ref.id, 'y', v),
        },
        {
          label: 'floors.slab',
          value: s.thickness,
          min: 25,
          name: 'Change slab',
          set: on<Slab>('thickness'),
        },
      ];
    }
    case 'room': {
      const r = findItem<Room>(floor, ref);
      if (!r) return [];
      const b = bbox(r.polygon);
      return [
        {
          label: 'room.width',
          value: b.maxX - b.minX,
          min: 300,
          name: 'Resize room',
          set: (f, v) => setRoomSize(f, ref.id, 'x', v),
        },
        {
          label: 'room.depth',
          value: b.maxY - b.minY,
          min: 300,
          name: 'Resize room',
          set: (f, v) => setRoomSize(f, ref.id, 'y', v),
        },
      ];
    }
    default:
      return [];
  }
}

/** Sizes of the selected item, right beside it, with a Done button. */
export function SizePopover({
  refItem,
  seed,
  onClose,
}: {
  refItem: ItemRef;
  seed: string;
  onClose: () => void;
}) {
  const t = useT();
  const floor = useApp(activeFloor);
  if (!floor) return null;
  const fields = sizeFields(floor, refItem);
  if (!fields.length) return null;
  const nextBox = (from: HTMLElement) => {
    const boxes = [...(from.closest('.float-panel')?.querySelectorAll<HTMLInputElement>('input') ?? [])];
    const next = boxes[boxes.indexOf(from as HTMLInputElement) + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      onClose();
    }
  };
  return (
    <div className="float-panel size-panel" data-testid="size-popover">
      <div className="size-fields">
        {fields.map((f, i) => (
          <LengthField
            key={f.label}
            label={t(f.label)}
            value={f.value}
            min={f.min}
            seed={i === 0 ? seed : undefined}
            autoFocus={i === 0}
            testId={`size-${i}`}
            onCommit={(v) =>
              useApp.getState().commitFloor(f.name, (d) => f.set(d, v), refItem.kind === 'room')
            }
            onEnter={() => {
              const el = document.activeElement as HTMLElement;
              setTimeout(() => nextBox(el), 0);
            }}
          />
        ))}
      </div>
      <button className="btn primary size-done" data-testid="size-done" onClick={onClose}>
        <Check size={16} aria-hidden="true" /> {t('common.done')}
      </button>
    </div>
  );
}
