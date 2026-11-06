import type { Vec2 } from '../core/model/types';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ArrowUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { bbox } from '../core/geometry/polygon';
import { setStairRotation } from '../editor2d/handles';
import { translateText, useT, type T } from '../app/i18n';
import { activeFloor, useApp } from '../app/store';
import { stairComfort } from '../catalog/stairs';
import { currencySymbol } from '../estimate/money';
import { OPENING_TYPES, STAIR_TYPES } from '../catalog/catalog';
import { wallLength } from '../core/geometry/wallGraph';
import {
  ROOM_TYPES,
  type Floor,
  type Opening,
  type PlacedObject,
  type Plant,
  type Room,
  type Stair,
  type Wall,
} from '../core/model/types';
import { areaUnitFor, convertArea, AREA_LABEL, formatArea, formatLength } from '../core/units';
import {
  clampOpenings,
  findItem,
  paintRoomWalls,
  setRoomSize,
  setSlabSize,
  setWallAngle,
  setWallLength,
  wallAngle,
  type ItemRef,
} from '../editor2d/commands';
import {
  AngleField,
  ColorField,
  LengthField,
  NumberField,
  SelectField,
  TextField,
  ToggleField,
} from './fields';
import { SelectionActions } from './SelectionActions';

/** Applies a field edit to one item as one named, undoable step. */
function useEdit(ref: ItemRef) {
  const commitFloor = useApp((s) => s.commitFloor);
  return <K extends string>(name: string, key: K, value: unknown, rooms = false) =>
    commitFloor(
      name,
      (f) => {
        const it = findItem<Record<string, unknown>>(f, ref);
        if (it) it[key] = value;
      },
      rooms,
    );
}

function WallPanel({ wall, floor }: { wall: Wall; floor: Floor }) {
  const t = useT();
  const ref: ItemRef = { kind: 'wall', id: wall.id };
  const edit = useEdit(ref);
  const commitFloor = useApp((s) => s.commitFloor);
  const isArc = Math.abs(wall.bulge) > 1e-3;
  const materials = [
    'red_brick',
    'fly_ash_brick',
    'aac_block',
    'concrete_block',
    'stone',
    'rcc',
    'glass',
    'wood',
    'mud_brick',
  ] as const;
  const textures = ['none', 'brick', 'stone', 'tile', 'wood', 'concrete', 'marble'] as const;
  return (
    <>
      <h3>{t('kind.wall')}</h3>
      {!isArc ? (
        <LengthField
          label={t('wall.length')}
          value={wallLength(wall)}
          min={50}
          testId="inspector-wall-length"
          onCommit={(v) => commitFloor('Change wall length', (f) => setWallLength(f, wall.id, v), true)}
        />
      ) : (
        <NumberField
          label={t('wall.bulge')}
          value={wall.bulge}
          min={-1}
          max={1}
          onCommit={(v) => edit('Change arc', 'bulge', v, true)}
        />
      )}
      {!isArc ? (
        <AngleField
          label={t('wall.angle')}
          value={wallAngle(wall)}
          onCommit={(v) => commitFloor('Change wall angle', (f) => setWallAngle(f, wall.id, v), true)}
        />
      ) : null}
      <LengthField
        label={t('wall.thickness')}
        value={wall.thickness}
        min={25}
        testId="inspector-wall-thickness"
        onCommit={(v) => edit('Change wall thickness', 'thickness', v, true)}
      />
      <LengthField
        label={t('wall.height')}
        value={wall.height}
        min={100}
        testId="inspector-wall-height"
        onCommit={(v) => edit('Change wall height', 'height', v)}
      />
      <div className="row-actions">
        <button
          className="btn small"
          onClick={() =>
            commitFloor('Set height on this floor', (f) => {
              f.walls.forEach((w) => {
                if (w.type !== 'parapet' && w.type !== 'compound') w.height = wall.height;
              });
            })
          }
        >
          {t('wall.heightFloor')}
        </button>
        <button
          className="btn small"
          onClick={() =>
            useApp.getState().commit('Set height on all floors', (d) => {
              d.floors.forEach((fl) =>
                fl.walls.forEach((w) => {
                  if (w.type !== 'parapet' && w.type !== 'compound') w.height = wall.height;
                }),
              );
            })
          }
        >
          {t('wall.heightAll')}
        </button>
      </div>
      <SelectField
        label={t('wall.type')}
        value={wall.type}
        options={(['outer', 'inner', 'parapet', 'retaining', 'compound', 'half', 'glass'] as const).map(
          (id) => ({ id, label: t(`walltype.${id}`) }),
        )}
        onCommit={(v) => edit('Change wall type', 'type', v, true)}
      />
      <SelectField
        label={t('wall.material')}
        value={wall.material}
        options={materials.map((id) => ({ id, label: t(`material.${id}`) }))}
        onCommit={(v) => edit('Change wall material', 'material', v)}
      />
      <ColorField
        label={t('wall.leftColor')}
        value={wall.leftColor}
        onCommit={(v) => edit('Change wall colour', 'leftColor', v)}
      />
      <ColorField
        label={t('wall.rightColor')}
        value={wall.rightColor}
        onCommit={(v) => edit('Change wall colour', 'rightColor', v)}
      />
      <details className="more">
        <summary>{t('common.more')}</summary>
        <LengthField
          label={t('wall.baseOffset')}
          value={wall.baseOffset}
          onCommit={(v) => edit('Change wall base', 'baseOffset', v)}
        />
        <LengthField
          label={t('wall.gable')}
          value={wall.gableRise}
          min={0}
          onCommit={(v) => edit('Change gable', 'gableRise', v)}
        />
        <SelectField
          label={t('wall.justification')}
          value={wall.justification}
          options={(['center', 'left', 'right'] as const).map((id) => ({ id, label: t(`just.${id}`) }))}
          onCommit={(v) => edit('Change justification', 'justification', v, true)}
        />
        <SelectField
          label={t('wall.leftTexture')}
          value={wall.leftTexture}
          options={textures.map((id) => ({ id, label: t(`texture.${id}`) }))}
          onCommit={(v) => edit('Change wall texture', 'leftTexture', v)}
        />
        <SelectField
          label={t('wall.rightTexture')}
          value={wall.rightTexture}
          options={textures.map((id) => ({ id, label: t(`texture.${id}`) }))}
          onCommit={(v) => edit('Change wall texture', 'rightTexture', v)}
        />
        <ColorField
          label={t('wall.topColor')}
          value={wall.topColor}
          onCommit={(v) => edit('Change wall colour', 'topColor', v)}
        />
        <LengthField
          label={t('wall.plasterLeft')}
          value={wall.plasterLeft}
          min={0}
          onCommit={(v) => edit('Change plaster', 'plasterLeft', v)}
        />
        <LengthField
          label={t('wall.plasterRight')}
          value={wall.plasterRight}
          min={0}
          onCommit={(v) => edit('Change plaster', 'plasterRight', v)}
        />
        <LengthField
          label={t('wall.skirting')}
          value={wall.skirtingHeight}
          min={0}
          onCommit={(v) => edit('Change skirting', 'skirtingHeight', v)}
        />
        <LengthField
          label={t('wall.dado')}
          value={wall.dadoHeight}
          min={0}
          onCommit={(v) => edit('Change dado', 'dadoHeight', v)}
        />
        <ColorField
          label={t('wall.dadoColor')}
          value={wall.dadoColor}
          onCommit={(v) => edit('Change dado colour', 'dadoColor', v)}
        />
        <ToggleField
          label={t('wall.loadBearing')}
          value={wall.loadBearing}
          onCommit={(v) => edit('Toggle load bearing', 'loadBearing', v)}
        />
        <ToggleField
          label={t('wall.dampProof')}
          value={wall.dampProof}
          onCommit={(v) => edit('Toggle damp-proof course', 'dampProof', v)}
        />
        <ToggleField
          label={t('common.hidden')}
          value={!!wall.hidden}
          onCommit={(v) => edit('Hide wall', 'hidden', v)}
        />
      </details>
      <p className="hint">
        {t('wall.hasOpenings').replace(
          '{n}',
          String(floor.openings.filter((o) => o.wallId === wall.id).length),
        )}
      </p>
    </>
  );
}

function OpeningPanel({ o, floor }: { o: Opening; floor: Floor }) {
  const t = useT();
  const edit = useEdit({ kind: 'opening', id: o.id });
  const commitFloor = useApp((s) => s.commitFloor);
  const wall = floor.walls.find((w) => w.id === o.wallId);
  const currency = useApp((s) => s.project?.settings.currency);
  const types = OPENING_TYPES.filter((x) => x.kind === o.kind);
  return (
    <>
      <h3>{t(`kind.${o.kind}`)}</h3>
      <SelectField
        label={t('opening.type')}
        value={o.catalogId}
        options={types.map((x) => ({ id: x.id, label: t(`obj.${x.id}`, x.name) }))}
        onCommit={(id) => {
          const x = types.find((k) => k.id === id)!;
          commitFloor('Change opening type', (f) => {
            const it = f.openings.find((k) => k.id === o.id);
            if (!it) return;
            Object.assign(it, {
              catalogId: x.id,
              width: x.width,
              height: x.height,
              sillHeight: x.sill,
              lintelHeight: x.sill + x.height,
              panels: x.panels,
              shutterMaterial: x.shutterMaterial,
              shutterColor: x.shutterColor,
              frameColor: x.frameColor,
            });
            const w = f.walls.find((k) => k.id === it.wallId);
            if (w) clampOpenings(f, w);
          });
        }}
      />
      <LengthField
        label={t('opening.position')}
        value={o.position}
        min={0}
        testId="inspector-opening-position"
        onCommit={(v) =>
          commitFloor('Move opening', (f) => {
            const it = f.openings.find((k) => k.id === o.id);
            const w = f.walls.find((k) => k.id === o.wallId);
            if (it && w) {
              it.position = v;
              clampOpenings(f, w);
            }
          })
        }
      />
      {wall ? (
        <p className="hint">{`${t('wall.length')}: ${formatLength(wallLength(wall), 'ftin', 'eighth')}`}</p>
      ) : null}
      <LengthField
        label={t('opening.width')}
        value={o.width}
        min={200}
        testId="inspector-opening-width"
        onCommit={(v) =>
          commitFloor('Change opening width', (f) => {
            const it = f.openings.find((k) => k.id === o.id);
            const w = f.walls.find((k) => k.id === o.wallId);
            if (it && w) {
              it.width = v;
              clampOpenings(f, w);
            }
          })
        }
      />
      <LengthField
        label={t('opening.height')}
        value={o.height}
        min={200}
        onCommit={(v) => edit('Change opening height', 'height', v)}
      />
      <LengthField
        label={t('opening.sill')}
        value={o.sillHeight}
        min={0}
        onCommit={(v) => edit('Change sill', 'sillHeight', v)}
      />
      <details className="more">
        <summary>{t('common.more')}</summary>
        <LengthField
          label={t('opening.lintel')}
          value={o.lintelHeight}
          min={0}
          onCommit={(v) => edit('Change lintel', 'lintelHeight', v)}
        />
        <LengthField
          label={t('opening.frameThickness')}
          value={o.frameThickness}
          min={10}
          onCommit={(v) => edit('Change frame', 'frameThickness', v)}
        />
        <TextField
          label={t('opening.frameMaterial')}
          value={o.frameMaterial}
          onCommit={(v) => edit('Change frame', 'frameMaterial', v)}
        />
        <ColorField
          label={t('opening.frameColor')}
          value={o.frameColor}
          onCommit={(v) => edit('Change frame colour', 'frameColor', v)}
        />
        <TextField
          label={t('opening.shutterMaterial')}
          value={o.shutterMaterial}
          onCommit={(v) => edit('Change shutter', 'shutterMaterial', v)}
        />
        <ColorField
          label={t('opening.shutterColor')}
          value={o.shutterColor}
          onCommit={(v) => edit('Change shutter colour', 'shutterColor', v)}
        />
        <NumberField
          label={t('opening.panels')}
          value={o.panels}
          min={0}
          max={6}
          onCommit={(v) => edit('Change panels', 'panels', Math.round(v))}
        />
        <NumberField
          label={t('opening.costOverride')}
          value={o.costOverride ?? 0}
          min={0}
          suffix={currencySymbol(currency)}
          onCommit={(v) => edit('Change cost', 'costOverride', v > 0 ? v : undefined)}
        />
      </details>
      {o.kind === 'door' ? (
        <>
          <SelectField
            label={t('opening.swingSide')}
            value={o.swingSide}
            options={[
              { id: 'left', label: t('just.left') },
              { id: 'right', label: t('just.right') },
            ]}
            onCommit={(v) => edit('Change swing', 'swingSide', v)}
          />
          <SelectField
            label={t('opening.swingDir')}
            value={o.swingDirection}
            options={[
              { id: 'in', label: t('opening.in') },
              { id: 'out', label: t('opening.out') },
            ]}
            onCommit={(v) => edit('Change swing', 'swingDirection', v)}
          />
          <ToggleField
            label={t('opening.mainEntrance')}
            testId="main-entrance"
            value={!!o.isMainEntrance}
            onCommit={(v) =>
              commitFloor('Set main entrance', (f, d) => {
                d.floors.forEach((fl) => fl.openings.forEach((k) => (k.isMainEntrance = false)));
                const it = f.openings.find((k) => k.id === o.id);
                if (it) it.isMainEntrance = v;
              })
            }
          />
        </>
      ) : (
        <>
          <TextField
            label={t('opening.glassType')}
            value={o.glassType}
            onCommit={(v) => edit('Change glass', 'glassType', v)}
          />
          <ColorField
            label={t('opening.glassTint')}
            value={o.glassTint}
            onCommit={(v) => edit('Change glass', 'glassTint', v)}
          />
          <ToggleField
            label={t('opening.grill')}
            value={o.grill}
            onCommit={(v) => edit('Toggle grill', 'grill', v)}
          />
          {o.grill ? (
            <SelectField
              label={t('opening.grillPattern')}
              value={o.grillPattern}
              options={(['bars', 'grid', 'diamond'] as const).map((id) => ({ id, label: t(`grill.${id}`) }))}
              onCommit={(v) => edit('Change grill', 'grillPattern', v)}
            />
          ) : null}
          <ToggleField
            label={t('opening.net')}
            value={o.mosquitoNet}
            onCommit={(v) => edit('Toggle net', 'mosquitoNet', v)}
          />
          <ToggleField
            label={t('opening.curtain')}
            value={o.curtain}
            onCommit={(v) => edit('Toggle curtain', 'curtain', v)}
          />
          {o.curtain ? (
            <ColorField
              label={t('opening.curtainColor')}
              value={o.curtainColor}
              onCommit={(v) => edit('Change curtain', 'curtainColor', v)}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function RoomPanel({ room }: { room: Room }) {
  const t = useT();
  const edit = useEdit({ kind: 'room', id: room.id });
  const commitFloor = useApp((s) => s.commitFloor);
  const unit = useApp((s) => s.project?.settings.displayUnit ?? 'ftin');
  const lang = useApp((s) => s.prefs.language);
  const areaUnit = areaUnitFor(unit);
  const finishes = ['vitrified', 'ceramic', 'marble', 'granite', 'kota', 'wood', 'cement', 'grass'] as const;
  return (
    <>
      <h3>{t('kind.room')}</h3>
      <TextField
        label={t('room.name')}
        value={translateText(lang, room.name)}
        testId="room-name"
        onCommit={(v) =>
          commitFloor('Rename room', (f) => {
            const r = f.rooms.find((x) => x.id === room.id);
            if (r) {
              r.name = v;
              r.userNamed = true;
            }
          })
        }
      />
      <SelectField
        label={t('room.type')}
        value={room.type}
        testId="room-type"
        options={ROOM_TYPES.map((id) => ({ id, label: t(`room.${id}`) }))}
        onCommit={(v) =>
          commitFloor('Change room type', (f) => {
            const r = f.rooms.find((x) => x.id === room.id);
            if (!r) return;
            r.type = v;
            if (!r.userNamed) r.name = t(`room.${v}`);
          })
        }
      />
      <div className="two-col">
        <LengthField
          label={t('room.width')}
          value={Math.max(...room.polygon.map((p) => p.x)) - Math.min(...room.polygon.map((p) => p.x))}
          min={300}
          testId="room-width"
          onCommit={(v) => commitFloor('Resize room', (f) => setRoomSize(f, room.id, 'x', v), true)}
        />
        <LengthField
          label={t('room.depth')}
          value={Math.max(...room.polygon.map((p) => p.y)) - Math.min(...room.polygon.map((p) => p.y))}
          min={300}
          testId="room-depth"
          onCommit={(v) => commitFloor('Resize room', (f) => setRoomSize(f, room.id, 'y', v), true)}
        />
      </div>
      <p className="stat" data-testid="room-area">
        {t('room.area')}: <strong>{formatArea(room.area, areaUnit)}</strong> (
        {formatArea(room.area, areaUnit === 'sqm' ? 'sqft' : 'sqm')},{' '}
        {convertArea(room.area, 'sqm', 'gaj2').toFixed(1)} {AREA_LABEL.gaj2})
      </p>
      <p className="stat">
        {t('room.perimeter')}: <strong>{formatLength(room.perimeter, unit, 'eighth')}</strong> ·{' '}
        {t('room.zone')}: <strong>{t(`zone.${room.zone}`)}</strong>
      </p>
      <SelectField
        label={t('room.floorFinish')}
        value={room.floorFinish}
        options={finishes.map((id) => ({ id, label: t(`finish.${id}`) }))}
        onCommit={(v) => edit('Change floor finish', 'floorFinish', v)}
      />
      <ColorField
        label={t('room.floorColor')}
        value={room.floorColor}
        onCommit={(v) => edit('Change floor colour', 'floorColor', v)}
      />
      <SelectField
        label={t('room.ceilingType')}
        value={room.ceilingType}
        options={(['plain', 'pop', 'gypsum', 'wood'] as const).map((id) => ({
          id,
          label: t(`ceiling.${id}`),
        }))}
        onCommit={(v) => edit('Change ceiling', 'ceilingType', v)}
      />
      <ColorField
        label={t('room.ceilingColor')}
        value={room.ceilingColor}
        onCommit={(v) => edit('Change ceiling colour', 'ceilingColor', v)}
      />
      <LengthField
        label={t('room.ceilingHeight')}
        value={room.ceilingHeight}
        min={1800}
        onCommit={(v) => edit('Change ceiling height', 'ceilingHeight', v)}
      />
      <ColorField
        label={t('room.wallPaint')}
        value={room.wallPaintColor}
        onCommit={(v) =>
          commitFloor('Paint room', (f) => {
            const r = f.rooms.find((x) => x.id === room.id);
            if (!r) return;
            r.wallPaintColor = v;
            paintRoomWalls(f, r, v);
          })
        }
      />
    </>
  );
}

function TransformFields({ refItem, t, rotationOnly }: { refItem: ItemRef; t: T; rotationOnly?: boolean }) {
  const floor = useApp(activeFloor);
  const commitFloor = useApp((s) => s.commitFloor);
  const it =
    floor && findItem<{ transform: { x: number; y: number; z: number; rotation: number } }>(floor, refItem);
  if (!it) return null;
  const set = (key: 'x' | 'y' | 'z' | 'rotation', v: number) =>
    commitFloor('Move item', (f) => {
      const k = findItem<{ transform: Record<string, number> }>(f, refItem);
      if (k) k.transform[key] = v;
    });
  return (
    <details className="more-fields">
      <summary>{t('inspector.position')}</summary>
      {!rotationOnly ? (
        <LengthField label={t('transform.x')} value={it.transform.x} onCommit={(v) => set('x', v)} />
      ) : null}
      {!rotationOnly ? (
        <LengthField label={t('transform.y')} value={it.transform.y} onCommit={(v) => set('y', v)} />
      ) : null}
      <AngleField
        label={t('transform.rotation')}
        value={it.transform.rotation}
        onCommit={(v) => set('rotation', v)}
      />
    </details>
  );
}

function ObjectPanel({ o }: { o: PlacedObject }) {
  const t = useT();
  const ref: ItemRef = { kind: 'object', id: o.id };
  const edit = useEdit(ref);
  const commitFloor = useApp((s) => s.commitFloor);
  return (
    <>
      <h3>{t(`obj.${o.catalogId}`, o.name)}</h3>
      <TextField label={t('common.name')} value={o.name} onCommit={(v) => edit('Rename', 'name', v)} />
      <LengthField
        label={t('object.width')}
        value={o.width}
        min={10}
        testId="inspector-object-width"
        onCommit={(v) => edit('Resize object', 'width', v)}
      />
      <LengthField
        label={t('object.depth')}
        value={o.depth}
        min={10}
        onCommit={(v) => edit('Resize object', 'depth', v)}
      />
      <LengthField
        label={t('object.height')}
        value={o.height}
        min={10}
        onCommit={(v) => edit('Resize object', 'height', v)}
      />
      <TransformFields refItem={ref} t={t} />
      <LengthField
        label={t('object.elevation')}
        value={o.transform.z}
        onCommit={(v) =>
          commitFloor('Raise object', (f) => {
            const k = f.objects.find((x) => x.id === o.id);
            if (k) k.transform.z = v;
          })
        }
      />
      {Object.entries(o.colors).map(([part, color]) => (
        <ColorField
          key={part}
          label={t(`part.${part}`, part)}
          value={color}
          onCommit={(v) =>
            commitFloor('Recolour object', (f) => {
              const k = f.objects.find((x) => x.id === o.id);
              if (k) k.colors[part] = v;
            })
          }
        />
      ))}
      <details className="more">
        <summary>{t('common.more')}</summary>
        {(['scaleX', 'scaleY', 'scaleZ'] as const).map((axis) => (
          <NumberField
            key={axis}
            label={t(`object.${axis}`)}
            value={o.transform[axis]}
            min={0.05}
            max={20}
            onCommit={(v) =>
              commitFloor('Resize object', (f) => {
                const k = f.objects.find((x) => x.id === o.id);
                if (k) k.transform[axis] = v;
              })
            }
          />
        ))}
        <TextField label={t('common.note')} value={o.note} onCommit={(v) => edit('Change note', 'note', v)} />
        <ToggleField
          label={t('common.hidden')}
          value={!!o.hidden}
          onCommit={(v) => edit('Hide item', 'hidden', v)}
        />
      </details>
    </>
  );
}

function StairPanel({ s }: { s: Stair }) {
  const t = useT();
  const ref: ItemRef = { kind: 'stair', id: s.id };
  const edit = useEdit(ref);
  const commitFloor = useApp((st) => st.commitFloor);
  const c = stairComfort(s);
  return (
    <>
      <h3>{t('kind.stair')}</h3>
      <TextField label={t('common.name')} value={s.name} onCommit={(v) => edit('Rename', 'name', v)} />
      <SelectField
        label={t('stair.shape')}
        value={s.catalogId}
        options={STAIR_TYPES.map((x) => ({ id: x.id, label: t(`obj.${x.id}`, x.name) }))}
        onCommit={(id) =>
          commitFloor('Change stair type', (f) => {
            const k = f.stairs.find((x) => x.id === s.id);
            const type = STAIR_TYPES.find((x) => x.id === id);
            if (k && type) {
              k.catalogId = type.id;
              k.shape = type.shape;
            }
          })
        }
      />
      <div className="field">
        <span className="row-label">{t('stair.direction')}</span>
        <div className="choice-row" role="group" aria-label={t('stair.direction')}>
          {(
            [
              [0, ArrowUp, 'rooms.side.above'],
              [90, ArrowRight, 'rooms.side.right'],
              [180, ArrowDown, 'rooms.side.below'],
              [270, ArrowLeft, 'rooms.side.left'],
            ] as const
          ).map(([deg, Icon, label]) => (
            <button
              key={deg}
              className={
                Math.round(((s.transform.rotation % 360) + 360) % 360) === deg
                  ? 'choice icon-only active'
                  : 'choice icon-only'
              }
              data-testid={`stair-dir-${deg}`}
              aria-label={t(label)}
              title={t(label)}
              onClick={() =>
                commitFloor('Rotate 90°', (f) => {
                  const k = f.stairs.find((x) => x.id === s.id);
                  if (k) setStairRotation(k, deg);
                })
              }
            >
              <Icon size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="field-pair">
        <AngleField
          label={t('stair.angle')}
          value={((s.transform.rotation % 360) + 360) % 360}
          testId="stair-angle"
          onCommit={(deg) =>
            commitFloor('Turn stairs', (f) => {
              const k = f.stairs.find((x) => x.id === s.id);
              if (k) setStairRotation(k, ((deg % 360) + 360) % 360);
            })
          }
        />
        <button
          className="btn flip-stair"
          data-testid="stair-flip"
          title={t('stair.flipHelp')}
          onClick={() =>
            commitFloor('Flip stairs', (f) => {
              const k = f.stairs.find((x) => x.id === s.id);
              if (k) setStairRotation(k, (k.transform.rotation + 180) % 360);
            })
          }
        >
          <ArrowUpDown size={16} aria-hidden="true" />
          {t('stair.flip')}
        </button>
      </div>
      <LengthField
        label={t('stair.width')}
        value={s.width}
        min={500}
        onCommit={(v) => edit('Change stair width', 'width', v)}
      />
      <LengthField
        label={t('stair.riser')}
        value={s.riser}
        min={100}
        onCommit={(v) => edit('Change riser', 'riser', v)}
      />
      <LengthField
        label={t('stair.tread')}
        value={s.tread}
        min={150}
        onCommit={(v) => edit('Change tread', 'tread', v)}
      />
      <LengthField
        label={t('stair.totalRise')}
        value={s.totalRise}
        min={300}
        onCommit={(v) => edit('Change rise', 'totalRise', v)}
      />
      <p className={c.comfortable ? 'stat' : 'stat warn'}>
        {t('stair.result')
          .replace('{n}', String(c.risers))
          .replace('{r}', c.actualRiser.toFixed(0))
          .replace('{v}', c.value.toFixed(0))}
        {c.comfortable ? '' : ` ${t('stair.uncomfortable')}`}
      </p>
      {s.shape !== 'straight' ? (
        <div className="field">
          <span className="row-label">{t('stair.turn')}</span>
          <div className="choice-row">
            <button
              className={s.turnLeft ? 'choice active' : 'choice'}
              data-testid="stair-turn-left"
              onClick={() => edit('Change turn', 'turnLeft', true)}
            >
              {t('rooms.side.left')}
            </button>
            <button
              className={!s.turnLeft ? 'choice active' : 'choice'}
              data-testid="stair-turn-right"
              onClick={() => edit('Change turn', 'turnLeft', false)}
            >
              {t('rooms.side.right')}
            </button>
          </div>
        </div>
      ) : null}
      <ColorField
        label={t('stair.treadColor')}
        value={s.treadColor}
        onCommit={(v) => edit('Recolour stairs', 'treadColor', v)}
      />
      <ToggleField
        label={t('stair.railing')}
        value={s.hasRailing}
        onCommit={(v) => edit('Toggle railing', 'hasRailing', v)}
      />
      <ColorField
        label={t('stair.railColor')}
        value={s.railColor}
        onCommit={(v) => edit('Recolour railing', 'railColor', v)}
      />
      <TransformFields refItem={ref} t={t} />
      <TextField label={t('common.note')} value={s.note} onCommit={(v) => edit('Change note', 'note', v)} />
      <ToggleField
        label={t('common.hidden')}
        value={!!s.hidden}
        onCommit={(v) => edit('Hide item', 'hidden', v)}
      />
    </>
  );
}

function PlantPanel({ p }: { p: Plant }) {
  const t = useT();
  const ref: ItemRef = { kind: 'plant', id: p.id };
  const edit = useEdit(ref);
  return (
    <>
      <h3>{t(`obj.${p.catalogId}`, p.name)}</h3>
      <TextField label={t('common.name')} value={p.name} onCommit={(v) => edit('Rename', 'name', v)} />
      <TransformFields refItem={ref} t={t} />
      <LengthField
        label={t('plant.spread')}
        value={p.spread}
        min={50}
        onCommit={(v) => edit('Resize plant', 'spread', v)}
      />
      <LengthField
        label={t('object.height')}
        value={p.height}
        min={10}
        onCommit={(v) => edit('Resize plant', 'height', v)}
      />
      <ColorField
        label={t('plant.foliage')}
        value={p.foliageColor}
        onCommit={(v) => edit('Recolour plant', 'foliageColor', v)}
      />
      <ColorField
        label={t('plant.trunk')}
        value={p.trunkColor}
        onCommit={(v) => edit('Recolour plant', 'trunkColor', v)}
      />
      <TextField label={t('common.note')} value={p.note} onCommit={(v) => edit('Change note', 'note', v)} />
      <ToggleField
        label={t('common.hidden')}
        value={!!p.hidden}
        onCommit={(v) => edit('Hide item', 'hidden', v)}
      />
    </>
  );
}

function GenericPanel({ selected, floor }: { selected: ItemRef; floor: Floor }) {
  const t = useT();
  const edit = useEdit(selected);
  const commitFloor = useApp((s) => s.commitFloor);
  const it = findItem<Record<string, unknown>>(floor, selected);
  if (!it) return null;
  const isTransform = 'transform' in it;
  return (
    <>
      <h3>{t(`kind.${selected.kind}`)}</h3>
      {'name' in it ? (
        <TextField
          label={t('common.name')}
          value={String(it.name)}
          onCommit={(v) => edit('Rename', 'name', v)}
        />
      ) : null}
      {isTransform ? <TransformFields refItem={selected} t={t} /> : null}
      {selected.kind === 'pillar' ? (
        <SelectField
          label={t('pillar.shape')}
          value={it.shape as 'rect' | 'round'}
          options={[
            { id: 'rect', label: t('pillar.rect') },
            { id: 'round', label: t('pillar.round') },
          ]}
          onCommit={(v) => edit('Change pillar', 'shape', v)}
        />
      ) : null}
      {'width' in it ? (
        <LengthField
          label={t('object.width')}
          value={it.width as number}
          min={50}
          onCommit={(v) => edit('Resize', 'width', v)}
        />
      ) : null}
      {'depth' in it ? (
        <LengthField
          label={t('object.depth')}
          value={it.depth as number}
          min={50}
          onCommit={(v) => edit('Resize', 'depth', v)}
        />
      ) : null}
      {'height' in it && selected.kind !== 'electrical' ? (
        <LengthField
          label={t('object.height')}
          value={it.height as number}
          min={50}
          onCommit={(v) => edit('Resize', 'height', v)}
        />
      ) : null}
      {selected.kind === 'electrical' ? (
        <LengthField
          label={t('electrical.height')}
          value={it.height as number}
          min={0}
          onCommit={(v) => edit('Change height', 'height', v)}
        />
      ) : null}
      {selected.kind === 'slab' ? (
        <>
          <div className="two-col">
            <LengthField
              label={t('room.width')}
              value={(() => {
                const b = bbox(it.polygon as Vec2[]);
                return b.maxX - b.minX;
              })()}
              min={100}
              testId="slab-width"
              onCommit={(v) => commitFloor('Change slab', (f) => setSlabSize(f, selected.id, 'x', v))}
            />
            <LengthField
              label={t('room.depth')}
              value={(() => {
                const b = bbox(it.polygon as Vec2[]);
                return b.maxY - b.minY;
              })()}
              min={100}
              testId="slab-depth"
              onCommit={(v) => commitFloor('Change slab', (f) => setSlabSize(f, selected.id, 'y', v))}
            />
          </div>
          <LengthField
            label={t('floors.slab')}
            value={it.thickness as number}
            min={25}
            onCommit={(v) => edit('Change slab', 'thickness', v)}
          />
          <LengthField
            label={t('object.elevation')}
            value={it.zOffset as number}
            onCommit={(v) => edit('Change slab', 'zOffset', v)}
          />
        </>
      ) : null}
      {'soffit' in it ? (
        <LengthField
          label={t('beam.soffit')}
          value={it.soffit as number}
          min={0}
          onCommit={(v) => edit('Change beam', 'soffit', v)}
        />
      ) : null}
      {'color' in it ? (
        <ColorField
          label={t('common.color')}
          value={it.color as string}
          onCommit={(v) => edit('Recolour', 'color', v)}
        />
      ) : null}
      {selected.kind === 'label' ? (
        <>
          <TextField
            label={t('editor.labelText')}
            value={String(it.text)}
            onCommit={(v) => edit('Edit label', 'text', v)}
          />
          <LengthField
            label={t('label.size')}
            value={it.size as number}
            min={50}
            onCommit={(v) => edit('Resize label', 'size', v)}
          />
        </>
      ) : null}
      {selected.kind === 'dimension' ? (
        <>
          <LengthField
            label={t('dimension.offset')}
            value={it.offset as number}
            onCommit={(v) => edit('Move dimension', 'offset', v)}
          />
          <SelectField
            label={t('dimension.arrow')}
            value={it.arrow as 'tick' | 'arrow' | 'dot'}
            options={(['tick', 'arrow', 'dot'] as const).map((id) => ({ id, label: t(`arrow.${id}`) }))}
            onCommit={(v) => edit('Change arrows', 'arrow', v)}
          />
        </>
      ) : null}
      {'note' in it ? (
        <TextField
          label={t('common.note')}
          value={String(it.note)}
          onCommit={(v) => edit('Change note', 'note', v)}
        />
      ) : null}
      {selected.kind === 'pillar' || selected.kind === 'beam' ? (
        <ToggleField
          label={t('common.hidden')}
          value={!!it.hidden}
          onCommit={(v) => edit('Hide item', 'hidden', v)}
        />
      ) : null}
    </>
  );
}

/** Says when a change has gone in, and gives one clear way to finish. */
function InspectorFoot() {
  const t = useT();
  const lang = useApp((s) => s.prefs.language);
  const last = useApp((s) => s.history.past[s.history.past.length - 1]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const at = last?.at ?? 0;
    setNow(Date.now());
    const left = at + 3000 - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left + 20);
    return () => clearTimeout(id);
  }, [last]);
  const recent = last && now - last.at < 3000;
  return (
    <div className="inspector-foot">
      <span className="saved-note" data-testid="inspector-note">
        {recent ? (
          <>
            <Check size={14} aria-hidden="true" /> {translateText(lang, last.name)}
          </>
        ) : null}
      </span>
      <button
        className="btn primary"
        data-testid="inspector-done"
        onClick={() => {
          // A box still being typed in takes effect first.
          (document.activeElement as HTMLElement | null)?.blur();
          setTimeout(() => {
            const s = useApp.getState();
            s.setInspector(false);
            s.setSelection([]);
          }, 0);
        }}
      >
        {t('common.done')}
      </button>
    </div>
  );
}

export function Inspector() {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const floor = useApp(activeFloor);
  const open = useApp((s) => s.inspectorOpen);
  const setInspector = useApp((s) => s.setInspector);
  if (!floor || !selection.length) return null;
  const sel = selection[0];
  let body;
  if (selection.length > 1) {
    body = <p className="stat">{t('editor.itemsSelected').replace('{n}', String(selection.length))}</p>;
  } else if (sel.kind === 'wall') {
    const w = floor.walls.find((x) => x.id === sel.id);
    body = w ? <WallPanel wall={w} floor={floor} /> : null;
  } else if (sel.kind === 'opening') {
    const o = floor.openings.find((x) => x.id === sel.id);
    body = o ? <OpeningPanel o={o} floor={floor} /> : null;
  } else if (sel.kind === 'room') {
    const r = floor.rooms.find((x) => x.id === sel.id);
    body = r ? <RoomPanel room={r} /> : null;
  } else if (sel.kind === 'object') {
    const o = floor.objects.find((x) => x.id === sel.id);
    body = o ? <ObjectPanel o={o} /> : null;
  } else if (sel.kind === 'stair') {
    const s = floor.stairs.find((x) => x.id === sel.id);
    body = s ? <StairPanel s={s} /> : null;
  } else if (sel.kind === 'plant') {
    const p = floor.plants.find((x) => x.id === sel.id);
    body = p ? <PlantPanel p={p} /> : null;
  } else {
    body = <GenericPanel selected={sel} floor={floor} />;
  }
  return (
    <aside className={open ? 'inspector open' : 'inspector'} data-testid="inspector">
      <div className="inspector-head">
        <button
          className="btn small inspector-toggle"
          onClick={() => setInspector(!open)}
          data-testid="inspector-toggle"
        >
          {open ? t('common.hide') : t('action.properties')}
        </button>
        <div className="selection-actions">
          <SelectionActions />
        </div>
      </div>
      <div className="inspector-body" key={selection.map((r) => r.id).join()}>
        {body}
      </div>
      <InspectorFoot />
    </aside>
  );
}
