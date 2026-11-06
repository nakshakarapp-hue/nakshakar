import { ChevronDown, ChevronUp, Copy, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LANGUAGES, translateText, useT } from '../app/i18n';
import { activeFloor, useApp } from '../app/store';
import { elevationById, ELEVATION_STYLES, openingTypeById } from '../catalog/catalog';
import {
  createOpening,
  createWall,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
} from '../core/model/defaults';
import { newId } from '../core/model/ids';
import {
  LAYER_CATEGORIES,
  type DisplayPrecision,
  type Floor,
  type LengthUnit,
  type Project,
  type Side,
  type ThemeName,
  type Vec2,
} from '../core/model/types';
import { add, snapPoint } from '../core/geometry/vec';
import { polygonArea } from '../core/geometry/polygon';
import {
  addSnapshot,
  deleteSnapshot,
  listSnapshots,
  renameSnapshot,
  saveProject,
  type Snapshot,
} from '../core/storage/db';
import {
  AREA_LABEL,
  AREA_UNITS,
  BIGHA_VARIANTS,
  convertArea,
  convertLength,
  convertVolume,
  convertWeight,
  formatArea,
  formatLength,
  LENGTH_UNITS,
  parseArea,
  parseLength,
  parseVolume,
  parseWeight,
  VOLUME_LABEL,
  VOLUME_UNITS,
  WEIGHT_LABEL,
  WEIGHT_UNITS,
  type AreaUnit,
  type VolumeUnit,
  type WeightUnit,
} from '../core/units';
import { addWallChain, addWallLoop, relevelFloors as relevelStack, syncRooms } from '../editor2d/commands';
import { CURRENCIES } from '../estimate/money';
import {
  buildableArea,
  plotFromSides,
  ROOM_SHAPES,
  shapeOutline,
  walkPerimeter,
  type PerimeterRow,
  type RoomShape,
} from '../editor2d/shapes';
import { Library } from './Library';
import { MoreSheet } from './MoreSheet';
import {
  AngleField,
  ColorField,
  Dialog,
  LengthField,
  NumberField,
  SelectField,
  TextField,
  ToggleField,
} from './fields';

/** A small picture of a room shape, drawn by the same code that builds the walls. */
function ShapePicture({ shape }: { shape: RoomShape }) {
  const outline = shapeOutline(shape, { length: 1000, breadth: 800, sides: 7, sideLength: 420 });
  const xs = outline.map((v) => v.x);
  const ys = outline.map((v) => v.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const pad = Math.max(w, h) * 0.08;
  return (
    <svg
      viewBox={`${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`}
      width="56"
      height="46"
      aria-hidden="true"
    >
      <polygon
        points={outline.map((v) => `${v.x},${v.y}`).join(' ')}
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth={Math.max(w, h) * 0.05}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const close = () => useApp.getState().setDialog(null);
  const t = useT();
  switch (dialog) {
    case 'wizard':
      return <RoomWizard onClose={close} />;
    case 'perimeter':
      return <PerimeterTable onClose={close} />;
    case 'plot':
      return <TracePlot onClose={close} />;
    case 'catalog':
      return <Library onClose={close} />;
    case 'shortcuts':
      return <Shortcuts onClose={close} />;
    case 'more':
      return <MoreSheet onClose={close} />;
    case 'floors':
      return <FloorManager onClose={close} />;
    case 'materials':
      return <MaterialsDialog onClose={close} />;
    case 'layers':
      return <Layers onClose={close} />;
    case 'site':
      return <SiteSettings onClose={close} />;
    case 'settings':
      return <ProjectSettingsDialog onClose={close} />;
    case 'history':
      return <HistoryList onClose={close} />;
    case 'versions':
      return <Versions onClose={close} />;
    case 'snap':
      return <SnapSettings onClose={close} />;
    case 'project':
      return <ProjectDialog onClose={close} />;
    case 'converter':
      return (
        <Dialog title={t('menu.converter')} onClose={close}>
          <UnitConverter />
        </Dialog>
      );
    default:
      return null;
  }
}

function RoomWizard({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [shape, setShape] = useState<RoomShape>('rectangle');
  const [length, setLength] = useState(3658);
  const [breadth, setBreadth] = useState(3048);
  const [height, setHeight] = useState(DEFAULT_WALL_HEIGHT);
  const [thickness, setThickness] = useState(DEFAULT_WALL_THICKNESS);
  const [sides, setSides] = useState(5);
  const [sideLength, setSideLength] = useState(2000);
  const [name, setName] = useState('');

  const drop = () => {
    const s = useApp.getState();
    const floor = activeFloor(s);
    if (!floor) return;
    // Drop to the right of what is already drawn, so a new room never lands on an old one.
    const xs = floor.walls.flatMap((w) => [w.start.x, w.end.x]);
    const ys = floor.walls.flatMap((w) => [w.start.y, w.end.y]);
    const origin: Vec2 = xs.length ? { x: Math.max(...xs) + 1000, y: Math.min(...ys) } : { x: 0, y: 0 };
    s.commitFloor(
      'Add room',
      (f, d) => {
        const over = { thickness, height };
        if (shape === 'circle') {
          const pts = shapeOutline('circle', { length, breadth }).map((p) => snapPoint(add(p, origin)));
          f.walls.push(
            createWall(pts[0], pts[1], { ...over, bulge: 1 }),
            createWall(pts[1], pts[0], { ...over, bulge: 1 }),
          );
        } else {
          addWallLoop(
            f,
            shapeOutline(shape, { length, breadth, sides, sideLength }).map((p) => add(p, origin)),
            over,
          );
        }
        syncRooms(f, d.settings.northAngleDeg);
        if (name.trim()) {
          const room = f.rooms[f.rooms.length - 1];
          if (room) {
            room.name = name.trim();
            room.userNamed = true;
          }
        }
      },
      false,
    );
    s.markMilestone('Room added');
    onClose();
  };

  return (
    <Dialog
      title={t('menu.wizard')}
      onClose={onClose}
      footer={
        <button className="btn primary" data-testid="wizard-drop" onClick={drop}>
          {t('wizard.drop')}
        </button>
      }
    >
      <div className="shape-grid" role="radiogroup" aria-label={t('wizard.shape')}>
        {ROOM_SHAPES.map((id) => (
          <button
            key={id}
            className={shape === id ? 'shape-card active' : 'shape-card'}
            data-testid={`wizard-shape-${id}`}
            role="radio"
            aria-checked={shape === id}
            onClick={() => setShape(id)}
          >
            <ShapePicture shape={id} />
            <span className="small">{t(`shape.${id}`)}</span>
          </button>
        ))}
      </div>
      {shape === 'ngon' ? (
        <>
          <NumberField
            label={t('wizard.sides')}
            value={sides}
            min={3}
            max={36}
            onCommit={(v) => setSides(Math.round(v))}
          />
          <LengthField label={t('wizard.sideLength')} value={sideLength} min={100} onCommit={setSideLength} />
        </>
      ) : (
        <>
          <LengthField
            label={shape === 'circle' ? t('wizard.diameter') : t('wizard.length')}
            value={length}
            min={300}
            onCommit={setLength}
            testId="wizard-length"
          />
          {!['circle', 'hexagon', 'octagon'].includes(shape) ? (
            <LengthField
              label={t('wizard.breadth')}
              value={breadth}
              min={300}
              onCommit={setBreadth}
              testId="wizard-breadth"
            />
          ) : null}
        </>
      )}
      <LengthField label={t('wall.height')} value={height} min={100} onCommit={setHeight} />
      <LengthField label={t('wall.thickness')} value={thickness} min={25} onCommit={setThickness} />
      <TextField label={t('room.name')} value={name} onCommit={setName} />
    </Dialog>
  );
}

interface TableRow extends PerimeterRow {
  id: string;
}

const emptyRow = (turn: number): TableRow => ({
  id: newId(),
  length: 3000,
  turn,
  thickness: DEFAULT_WALL_THICKNESS,
  height: DEFAULT_WALL_HEIGHT,
});

function PerimeterTable({ onClose }: { onClose: () => void }) {
  const t = useT();
  const unit = useApp((s) => s.project?.settings.displayUnit ?? 'ftin');
  const [rows, setRows] = useState<TableRow[]>([emptyRow(0), emptyRow(90), emptyRow(90), emptyRow(90)]);
  const [startAngle, setStartAngle] = useState(0);
  const result = useMemo(() => walkPerimeter(rows, startAngle), [rows, startAngle]);
  const update = (id: string, patch: Partial<TableRow>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Live preview, scaled to fit.
  const preview = useMemo(() => {
    const pts = result.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
    return pts
      .map((p) => `${10 + ((p.x - minX) / span) * 180},${10 + ((p.y - minY) / span) * 130}`)
      .join(' ');
  }, [result]);

  const build = () => {
    const s = useApp.getState();
    const floor = activeFloor(s);
    if (!floor) return;
    const xs = floor.walls.flatMap((w) => [w.start.x, w.end.x]);
    const ys = floor.walls.flatMap((w) => [w.start.y, w.end.y]);
    const origin: Vec2 = xs.length ? { x: Math.max(...xs) + 1000, y: Math.min(...ys) } : { x: 0, y: 0 };
    const pts = result.points.map((p) => add(p, origin));
    if (result.closes) pts[pts.length - 1] = pts[0];
    s.commitFloor(
      'Build from perimeter table',
      (f) => {
        addWallChain(f, pts, (i) => ({ thickness: rows[i].thickness, height: rows[i].height }));
      },
      true,
    );
    s.markMilestone('Perimeter built');
    onClose();
  };

  return (
    <Dialog
      wide
      title={t('menu.perimeter')}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            data-testid="perimeter-add"
            onClick={() => setRows([...rows, emptyRow(90)])}
          >
            {t('perimeter.addSide')}
          </button>
          <button className="btn primary" data-testid="perimeter-build" onClick={build}>
            {t('perimeter.build')}
          </button>
        </>
      }
    >
      <AngleField label={t('perimeter.startAngle')} value={startAngle} onCommit={setStartAngle} />
      <div className="perimeter-layout">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('wall.length')}</th>
                <th>{t('perimeter.turn')}</th>
                <th>{t('wall.thickness')}</th>
                <th>{t('wall.height')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>
                    <LengthField
                      label=""
                      live
                      value={r.length}
                      min={10}
                      testId={`perimeter-length-${i}`}
                      onCommit={(v) => update(r.id, { length: v })}
                    />
                  </td>
                  <td>
                    {i === 0 ? (
                      '—'
                    ) : (
                      <AngleField
                        label=""
                        live
                        value={r.turn}
                        testId={`perimeter-turn-${i}`}
                        onCommit={(v) => update(r.id, { turn: v })}
                      />
                    )}
                  </td>
                  <td>
                    <LengthField
                      label=""
                      value={r.thickness}
                      min={25}
                      onCommit={(v) => update(r.id, { thickness: v })}
                    />
                  </td>
                  <td>
                    <LengthField
                      label=""
                      value={r.height}
                      min={100}
                      onCommit={(v) => update(r.id, { height: v })}
                    />
                  </td>
                  <td>
                    <button
                      className="btn small"
                      aria-label={t('action.delete')}
                      disabled={rows.length <= 1}
                      onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <svg className="perimeter-preview" viewBox="0 0 200 150" aria-hidden="true">
          <polyline points={preview} fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <p className={result.closes ? 'stat good' : 'stat warn'} data-testid="closing-error">
        {result.closes
          ? t('perimeter.closes')
          : `${t('perimeter.closingError')}: ${formatLength(result.closingError, unit, 'eighth')}`}
      </p>
    </Dialog>
  );
}

interface PlotSide {
  id: string;
  length: number;
  turn: number;
  setback: number;
}

function TracePlot({ onClose }: { onClose: () => void }) {
  const t = useT();
  const site = useApp((s) => s.project?.site);
  const [rows, setRows] = useState<PlotSide[]>(() =>
    [9144, 12192, 9144, 12192].map((length, i) => ({
      id: newId(),
      length,
      turn: 90,
      setback: site
        ? [site.setbacks.front, site.setbacks.right, site.setbacks.rear, site.setbacks.left][i]
        : 1000,
    })),
  );
  const [compound, setCompound] = useState(false);
  const four = rows.length === 4;
  const sides = rows.map((r) => r.length);
  const setbacks = rows.map((r) => r.setback);
  // Four sides solve as the closest quadrilateral; any other count is walked with the typed turns.
  const plot = useMemo(() => {
    const lengths = rows.map((r) => r.length);
    return rows.length === 4
      ? plotFromSides(lengths)
      : plotFromSides(
          lengths,
          rows.map((r) => r.turn),
        );
  }, [rows]);
  const inset = useMemo(() => buildableArea(plot, setbacks), [rows, plot]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (id: string, patch: Partial<PlotSide>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const sideName = (i: number) =>
    four ? t(['plot.north', 'plot.east', 'plot.south', 'plot.west'][i]) : `${t('plot.side')} ${i + 1}`;

  const apply = (buildWalls: boolean) => {
    const s = useApp.getState();
    s.commit('Set plot', (d) => {
      d.site.plot = plot;
      d.site.plotWidth = sides[0];
      d.site.plotLength = sides[1];
      d.site.setbackList = four ? undefined : setbacks;
      if (four)
        d.site.setbacks = { front: setbacks[0], right: setbacks[1], rear: setbacks[2], left: setbacks[3] };
      const floor = d.floors.find((f) => f.id === s.activeFloorId) ?? d.floors[0];
      if (buildWalls && inset.length >= 3) addWallLoop(floor, inset);
      if (compound) {
        const ground = d.floors.find((f) => f.levelIndex === 0) ?? d.floors[0];
        const [front] = addWallLoop(ground, plot, {
          type: 'compound',
          height: 1500,
          thickness: 150,
          baseOffset: -d.site.groundLevelOffset,
        });
        // A wall all the way round needs a way in: the gate goes in the middle of the first side.
        const gate = openingTypeById.get('door_gate');
        if (gate && sides[0] > 3600) {
          ground.openings.push(
            createOpening(front, sides[0] / 2, 'door', {
              catalogId: gate.id,
              width: 3000,
              height: 1800,
              sillHeight: 0,
              lintelHeight: 1800,
              panels: 2,
              shutterMaterial: gate.shutterMaterial,
              shutterColor: gate.shutterColor,
              frameColor: gate.frameColor,
            }),
          );
        }
        syncRooms(ground, d.settings.northAngleDeg);
      }
      syncRooms(floor, d.settings.northAngleDeg);
    });
    onClose();
  };

  return (
    <Dialog
      wide
      title={t('menu.plot')}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            data-testid="plot-add-side"
            onClick={() =>
              setRows([
                ...rows,
                { id: newId(), length: 6000, turn: Math.round(360 / (rows.length + 1)), setback: 1000 },
              ])
            }
          >
            {t('perimeter.addSide')}
          </button>
          <button className="btn" data-testid="plot-set" onClick={() => apply(false)}>
            {t('plot.setOnly')}
          </button>
          <button
            className="btn primary"
            data-testid="plot-build"
            disabled={inset.length < 3}
            onClick={() => apply(true)}
          >
            {t('plot.buildInset')}
          </button>
        </>
      }
    >
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t('plot.side')}</th>
              <th>{t('wall.length')}</th>
              {!four ? <th>{t('perimeter.turn')}</th> : null}
              <th>{t('plot.setback')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{sideName(i)}</td>
                <td>
                  <LengthField
                    label=""
                    live
                    value={r.length}
                    min={500}
                    testId={`plot-side-${i}`}
                    onCommit={(v) => update(r.id, { length: v })}
                  />
                </td>
                {!four ? (
                  <td>
                    {i === 0 ? (
                      '—'
                    ) : (
                      <AngleField
                        label=""
                        live
                        value={r.turn}
                        testId={`plot-turn-${i}`}
                        onCommit={(v) => update(r.id, { turn: v })}
                      />
                    )}
                  </td>
                ) : null}
                <td>
                  <LengthField
                    label=""
                    live
                    value={r.setback}
                    min={0}
                    testId={`plot-setback-${i}`}
                    onCommit={(v) => update(r.id, { setback: v })}
                  />
                </td>
                <td>
                  <button
                    className="btn small"
                    aria-label={t('action.delete')}
                    disabled={rows.length <= 3}
                    onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ToggleField
        label={t('plot.compound')}
        testId="plot-compound"
        value={compound}
        onCommit={setCompound}
      />
      <p className="stat">
        {t('plot.area')}: <strong>{formatArea(polygonArea(plot) / 1e6, 'sqft')}</strong> (
        {formatArea(polygonArea(plot) / 1e6, 'sqm')}, {formatArea(polygonArea(plot) / 1e6, 'cent')})
      </p>
      <p className="stat" data-testid="buildable-area">
        {t('plot.buildable')}:{' '}
        <strong>{inset.length >= 3 ? formatArea(polygonArea(inset) / 1e6, 'sqft') : t('plot.none')}</strong>
      </p>
      <p className="hint">{t(four ? 'plot.hint' : 'plot.hintMany')}</p>
    </Dialog>
  );
}

const WALL_MATERIALS = [
  'red_brick',
  'fly_ash_brick',
  'aac_block',
  'concrete_block',
  'stone',
  'rcc',
  'wood',
  'mud_brick',
] as const;
const OVERRIDE_TEXTURES = ['none', 'brick', 'stone', 'tile', 'wood', 'concrete', 'marble'] as const;

/** Changes how a wall material looks everywhere in the project, in one place. */
function MaterialsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const materials = useApp((s) => s.project?.materials) ?? {};
  const commit = useApp((s) => s.commit);
  return (
    <Dialog title={t('menu.materials')} onClose={onClose} wide>
      <p className="hint">{t('materials.help')}</p>
      <div className="material-list">
        {WALL_MATERIALS.map((m) => (
          <div className="material-row" key={m} data-testid={`material-${m}`}>
            <strong>{t(`material.${m}`)}</strong>
            <ColorField
              label={t('common.color')}
              value={materials[m]?.color ?? '#f4efe6'}
              onCommit={(color) =>
                commit('Change material', (d) => void (d.materials[m] = { ...d.materials[m], color }))
              }
            />
            <SelectField
              label={t('materials.finish')}
              value={materials[m]?.texture ?? 'none'}
              options={OVERRIDE_TEXTURES.map((id) => ({ id, label: t(`texture.${id}`) }))}
              onCommit={(texture) =>
                commit('Change material', (d) => void (d.materials[m] = { ...d.materials[m], texture }))
              }
            />
            <button
              className="btn small"
              disabled={!materials[m]}
              onClick={() => commit('Change material', (d) => void delete d.materials[m])}
            >
              {t('materials.reset')}
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function FloorManager({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const activeId = useApp((s) => s.activeFloorId);
  const lang = useApp((s) => s.prefs.language);
  const unit = useApp((s) => s.project?.settings.displayUnit ?? 'ftin');
  const [adding, setAdding] = useState(false);
  const store = useApp.getState();
  if (!project) return null;

  const addAndClose = (run: () => void) => {
    run();
    const name =
      useApp.getState().project?.floors.find((f) => f.id === useApp.getState().activeFloorId)?.name ?? '';
    store.showToast(t('rooms.added').replace('{name}', translateText(lang, name)));
    onClose();
  };
  const current = project.floors.find((f) => f.id === activeId);

  if (adding) {
    const upper: [string, string, string, () => void][] = [
      [
        'add-floor-same',
        'floors.same',
        'floors.sameBody',
        () => addAndClose(() => store.addFloor('upper', 'layout')),
      ],
      [
        'add-floor-all',
        'floors.all',
        'floors.allBody',
        () => addAndClose(() => store.addFloor('upper', 'all')),
      ],
      [
        'add-floor-empty',
        'floors.empty',
        'floors.emptyBody',
        () => addAndClose(() => store.addFloor('upper', 'empty')),
      ],
    ];
    const other: [string, string, string, () => void][] = [
      [
        'add-terrace',
        'floors.addTerrace',
        'floors.terraceBody',
        () => addAndClose(() => store.addFloor('terrace')),
      ],
      [
        'add-basement',
        'floors.addBasement',
        'floors.basementBody',
        () => addAndClose(() => store.addFloor('basement')),
      ],
    ];
    const option = ([id, title, body, run]: (typeof upper)[number]) => (
      <button key={id} className="option-row" data-testid={id} onClick={run}>
        <strong>{t(title)}</strong>
        <span className="muted small">{t(body)}</span>
      </button>
    );
    return (
      <Dialog
        title={t('floors.add')}
        onClose={onClose}
        footer={
          <button className="btn" data-testid="add-floor-back" onClick={() => setAdding(false)}>
            {t('common.back')}
          </button>
        }
      >
        <h3 className="section-title">
          {t('floors.aboveAll')}
          {current ? ` · ${t('floors.from').replace('{name}', translateText(lang, current.name))}` : ''}
        </h3>
        <div className="option-list">{upper.map(option)}</div>
        <h3 className="section-title">{t('floors.other')}</h3>
        <div className="option-list">{other.map(option)}</div>
      </Dialog>
    );
  }

  const change = (id: string, name: string, run: (f: Floor) => void) =>
    store.commit(name, (d) => {
      const x = d.floors.find((k) => k.id === id);
      if (x) run(x);
    });

  return (
    <Dialog
      title={t('menu.floors')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" data-testid="floors-done" onClick={onClose}>
            {t('common.done')}
          </button>
          <button className="btn primary" data-testid="add-floor" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> {t('floors.add')}
          </button>
        </>
      }
    >
      <p className="muted small">{t('floors.help')}</p>
      <ul className="floor-list" data-testid="floor-list">
        {[...project.floors].reverse().map((f) => {
          const index = project.floors.indexOf(f);
          return (
            <li
              key={f.id}
              className={f.id === activeId ? 'floor-row active' : 'floor-row'}
              data-testid={`floor-row-${index}`}
            >
              <div className="floor-main">
                <div className="floor-order">
                  <button
                    className="btn ghost tight"
                    data-testid={`floor-up-${index}`}
                    aria-label={t('floors.moveUp')}
                    title={t('floors.moveUp')}
                    disabled={index === project.floors.length - 1}
                    onClick={() => store.moveFloor(f.id, 1)}
                  >
                    <ChevronUp size={18} aria-hidden="true" />
                  </button>
                  <button
                    className="btn ghost tight"
                    data-testid={`floor-down-${index}`}
                    aria-label={t('floors.moveDown')}
                    title={t('floors.moveDown')}
                    disabled={index === 0}
                    onClick={() => store.moveFloor(f.id, -1)}
                  >
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                </div>
                <button
                  className="floor-open"
                  data-testid={`floor-open-${index}`}
                  onClick={() => {
                    store.setFloor(f.id);
                    onClose();
                  }}
                >
                  <strong>{translateText(lang, f.name)}</strong>
                  <span className="muted small">
                    {t('floors.summary')
                      .replace('{rooms}', String(f.rooms.length))
                      .replace('{height}', formatLength(f.floorToFloor, unit, 0))}
                  </span>
                </button>
                <button
                  className="btn ghost tight"
                  data-testid="copy-floor"
                  aria-label={t('floors.copy')}
                  title={t('floors.copy')}
                  onClick={() => store.addFloor('upper', 'all', f.id)}
                >
                  <Copy size={17} aria-hidden="true" />
                </button>
                <button
                  className="btn ghost tight danger-ink"
                  data-testid={`floor-delete-${index}`}
                  aria-label={t('action.delete')}
                  title={t('action.delete')}
                  disabled={project.floors.length <= 1}
                  onClick={() => {
                    if (activeId === f.id)
                      store.setFloor(project.floors.find((k) => k.id !== f.id)?.id ?? '');
                    store.commit('Delete floor', (d) => {
                      d.floors = d.floors.filter((k) => k.id !== f.id);
                      relevelStack(d.floors, d.floors.filter((k) => k.levelIndex < 0).length);
                    });
                  }}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
              <details className="floor-more">
                <summary>{t('floors.details')}</summary>
                <TextField
                  label={t('common.name')}
                  value={translateText(lang, f.name)}
                  onCommit={(v) => change(f.id, 'Rename floor', (x) => (x.name = v))}
                />
                <div className="two-col">
                  <LengthField
                    label={t('floors.height')}
                    value={f.floorToFloor}
                    min={500}
                    onCommit={(v) =>
                      store.commit('Change floor height', (d) => {
                        const i = d.floors.findIndex((k) => k.id === f.id);
                        const before = d.floors[i].floorToFloor;
                        d.floors[i].floorToFloor = v;
                        d.floors[i].stairs.forEach((st) => {
                          if (st.totalRise === before) st.totalRise = v;
                        });
                        for (let k = i + 1; k < d.floors.length; k++)
                          d.floors[k].elevation = d.floors[k - 1].elevation + d.floors[k - 1].floorToFloor;
                      })
                    }
                  />
                  <LengthField
                    label={t('floors.slab')}
                    value={f.slabThickness}
                    min={50}
                    onCommit={(v) => change(f.id, 'Change slab', (x) => (x.slabThickness = v))}
                  />
                </div>
                <ColorField
                  label={t('floors.colorTag')}
                  value={f.colorTag}
                  onCommit={(v) => change(f.id, 'Change floor colour', (x) => (x.colorTag = v))}
                />
                <div className="row-actions">
                  <ToggleField
                    label={t('floors.visible')}
                    value={f.visible}
                    onCommit={(v) => change(f.id, 'Toggle floor', (x) => (x.visible = v))}
                  />
                  <ToggleField
                    label={t('floors.locked')}
                    value={f.locked}
                    onCommit={(v) => change(f.id, 'Lock floor', (x) => (x.locked = v))}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ['W', 'tool.wall'],
  ['R', 'tool.rect'],
  ['P', 'tool.polygon'],
  ['A', 'tool.arc'],
  ['D', 'tool.door'],
  ['N', 'tool.window'],
  ['S', 'tool.stair'],
  ['F', 'tool.object'],
  ['G', 'tool.plant'],
  ['K', 'tool.pillar'],
  ['B', 'tool.beam'],
  ['O', 'tool.paint'],
  ['M', 'tool.dimension'],
  ['T', 'tool.label'],
  ['V', 'tool.select'],
  ['L', 'tool.lasso'],
];

const ACTIONS: [string, string][] = [
  ['0-9', 'shortcuts.type'],
  ['Enter', 'shortcuts.enter'],
  ['Esc', 'shortcuts.esc'],
  ['Delete', 'action.delete'],
  ['← ↑ → ↓', 'shortcuts.arrows'],
  ['Shift + ← ↑ → ↓', 'shortcuts.arrowsFar'],
  ['C', 'shortcuts.connected'],
  ['Ctrl + Z', 'action.undo'],
  ['Ctrl + Y', 'action.redo'],
  ['Ctrl + C', 'action.copy'],
  ['Ctrl + X', 'shortcuts.cut'],
  ['Ctrl + V', 'action.paste'],
  ['Ctrl + A', 'shortcuts.all'],
  ['Page Up / Page Down', 'shortcuts.floors'],
  ['Home', 'editor.fit'],
  ['+ / -', 'shortcuts.zoom'],
];

const GAME_KEYS: [string, string][] = [
  ['W A S D', 'shortcuts.walk'],
  ['Shift', 'shortcuts.run'],
  ['← →', 'shortcuts.turn'],
  ['Space', 'game.jump'],
  ['E', 'shortcuts.open'],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  const t = useT();
  const table = (title: string, rows: [string, string][]) => (
    <section>
      <h3 className="section-title">{t(title)}</h3>
      <dl className="key-table">
        {rows.map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{t(label)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <Dialog title={t('shortcuts.title')} onClose={onClose} wide>
      <div className="key-columns" data-testid="shortcuts">
        {table('shortcuts.tools', SHORTCUTS)}
        {table('shortcuts.actions', ACTIONS)}
        {table('shortcuts.game', GAME_KEYS)}
      </div>
    </Dialog>
  );
}

function Layers({ onClose }: { onClose: () => void }) {
  const t = useT();
  const floor = useApp(activeFloor);
  const settings = useApp((s) => s.project?.settings);
  const store = useApp.getState();
  if (!floor || !settings) return null;
  const set = (patch: Partial<typeof settings>) =>
    store.commit('Change display', (d) => Object.assign(d.settings, patch));
  return (
    <Dialog title={t('menu.layers')} onClose={onClose}>
      <h3>{floor.name}</h3>
      {LAYER_CATEGORIES.map((cat) => (
        <ToggleField
          key={cat}
          label={t(`layer.${cat}`)}
          testId={`layer-${cat}`}
          value={!floor.hiddenCategories.includes(cat)}
          onCommit={(v) =>
            store.commitFloor('Toggle layer', (f) => {
              f.hiddenCategories = v
                ? f.hiddenCategories.filter((c) => c !== cat)
                : [...f.hiddenCategories, cat];
            })
          }
        />
      ))}
      <button
        className="btn"
        data-testid="show-hidden"
        onClick={() =>
          store.commitFloor('Show hidden items', (f) => {
            for (const list of [f.walls, f.stairs, f.pillars, f.beams, f.objects, f.plants] as {
              hidden?: boolean;
            }[][]) {
              list.forEach((it) => {
                it.hidden = false;
              });
            }
          })
        }
      >
        {t('layers.showHidden')}
      </button>
      <h3>{t('layers.annotations')}</h3>
      <ToggleField
        label={t('layers.dimensions')}
        testId="show-dimensions"
        value={settings.showDimensions}
        onCommit={(showDimensions) => set({ showDimensions })}
      />
      <ToggleField
        label={t('layers.area')}
        value={settings.showArea}
        onCommit={(showArea) => set({ showArea })}
      />
      <ToggleField
        label={t('layers.furnitureLabels')}
        value={settings.showFurnitureLabels}
        onCommit={(showFurnitureLabels) => set({ showFurnitureLabels })}
      />
      <SelectField
        label={t('layers.dimensionMode')}
        value={settings.dimensionMode}
        options={(['outer', 'inner', 'center'] as const).map((id) => ({ id, label: t(`dimmode.${id}`) }))}
        onCommit={(dimensionMode) => set({ dimensionMode })}
      />
      <NumberField
        label={t('layers.dimensionText')}
        value={settings.dimensionTextScale}
        min={0.5}
        max={3}
        onCommit={(dimensionTextScale) => set({ dimensionTextScale })}
      />
      <SelectField
        label={t('dimension.arrow')}
        value={settings.dimensionArrow ?? 'tick'}
        options={(['tick', 'arrow', 'dot'] as const).map((id) => ({ id, label: t(`arrow.${id}`) }))}
        onCommit={(dimensionArrow) => set({ dimensionArrow })}
      />
      <ToggleField
        label={t('layers.dimensionBold')}
        value={!!settings.dimensionBold}
        onCommit={(dimensionBold) => set({ dimensionBold })}
      />
    </Dialog>
  );
}

function SnapSettings({ onClose }: { onClose: () => void }) {
  const t = useT();
  const settings = useApp((s) => s.project?.settings);
  const commit = useApp((s) => s.commit);
  if (!settings) return null;
  const keys = [
    'grid',
    'endpoint',
    'midpoint',
    'centerLine',
    'face',
    'intersection',
    'perpendicular',
    'parallel',
    'angle',
    'equalLength',
    'haptics',
  ] as const;
  return (
    <Dialog title={t('menu.snap')} onClose={onClose}>
      <ToggleField
        label={t('snap.enabled')}
        testId="snap-enabled"
        value={settings.snapEnabled}
        onCommit={(v) => commit('Toggle snapping', (d) => void (d.settings.snapEnabled = v))}
      />
      <LengthField
        label={t('snap.gridSize')}
        value={settings.gridSize}
        min={1}
        onCommit={(v) => commit('Change grid', (d) => void (d.settings.gridSize = v))}
      />
      {keys.map((k) => (
        <ToggleField
          key={k}
          label={t(`snap.${k}`)}
          value={settings.snapOptions[k]}
          onCommit={(v) => commit('Change snapping', (d) => void (d.settings.snapOptions[k] = v))}
        />
      ))}
    </Dialog>
  );
}

function SiteSettings({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const commit = useApp((s) => s.commit);
  if (!project) return null;
  const { site, settings } = project;
  const sideOptions = [
    { id: 'none', label: t('common.none') },
    ...(['N', 'E', 'S', 'W'] as Side[]).map((id) => ({ id, label: t(`dir.${id}`) })),
  ] as { id: Side | 'none'; label: string }[];
  const setSite = (patch: Partial<typeof site>) => commit('Change site', (d) => Object.assign(d.site, patch));
  return (
    <Dialog title={t('menu.site')} onClose={onClose}>
      <NumberField
        label={t('site.north')}
        value={settings.northAngleDeg}
        min={0}
        max={359}
        suffix="°"
        onCommit={(v) =>
          commit('Set north', (d) => {
            d.settings.northAngleDeg = v;
            d.floors.forEach((f) => syncRooms(f, v));
          })
        }
      />
      <LengthField
        label={t('site.plotWidth')}
        value={site.plotWidth}
        min={1000}
        onCommit={(plotWidth) => setSite({ plotWidth })}
      />
      <LengthField
        label={t('site.plotLength')}
        value={site.plotLength}
        min={1000}
        onCommit={(plotLength) => setSite({ plotLength })}
      />
      <SelectField
        label={t('site.road')}
        testId="road-side"
        value={site.roadSide}
        options={sideOptions}
        onCommit={(roadSide) => setSite({ roadSide })}
      />
      <SelectField
        label={t('site.slope')}
        value={site.slopeDirection}
        options={sideOptions}
        onCommit={(slopeDirection) => setSite({ slopeDirection })}
      />
      <NumberField
        label={t('site.slopePercent')}
        value={site.slopePercent}
        min={0}
        max={100}
        suffix="%"
        onCommit={(slopePercent) => setSite({ slopePercent })}
      />
      <LengthField
        label={t('site.plinth')}
        value={site.groundLevelOffset}
        min={0}
        onCommit={(groundLevelOffset) => setSite({ groundLevelOffset })}
      />
      <h3>{t('site.elevation')}</h3>
      <SelectField
        label={t('site.style')}
        testId="elevation-style"
        value={project.elevationStyleId}
        options={ELEVATION_STYLES.map((e) => ({ id: e.id, label: t(`obj.${e.id}`, e.name) }))}
        onCommit={(id) => {
          const style = elevationById.get(id);
          if (!style) return;
          commit(`Apply ${style.name}`, (d) => {
            d.elevationStyleId = id;
            d.roof.type = style.roof;
            d.roof.color = style.roofColor;
            d.roof.parapetHeight = style.parapet;
            d.roof.overhang = style.overhang;
            d.roof.rise = style.rise || d.roof.rise;
            d.elevationOverrides = { wallColor: style.wall, accentColor: style.accent };
          });
        }}
      />
      <ColorField
        label={t('site.wallColor')}
        value={
          project.elevationOverrides.wallColor ??
          elevationById.get(project.elevationStyleId)?.wall ??
          '#f4efe6'
        }
        onCommit={(v) => commit('Change elevation colour', (d) => void (d.elevationOverrides.wallColor = v))}
      />
      <ColorField
        label={t('site.accentColor')}
        value={
          project.elevationOverrides.accentColor ??
          elevationById.get(project.elevationStyleId)?.accent ??
          '#39424e'
        }
        onCommit={(v) =>
          commit('Change elevation colour', (d) => void (d.elevationOverrides.accentColor = v))
        }
      />
      <h3>{t('site.roof')}</h3>
      <SelectField
        label={t('site.roofType')}
        value={project.roof.type}
        options={(['flat', 'gable', 'hip', 'shed'] as const).map((id) => ({ id, label: t(`roof.${id}`) }))}
        onCommit={(v) => commit('Change roof', (d) => void (d.roof.type = v))}
      />
      <LengthField
        label={t('site.overhang')}
        value={project.roof.overhang}
        min={0}
        onCommit={(v) => commit('Change roof', (d) => void (d.roof.overhang = v))}
      />
      <LengthField
        label={t('site.rise')}
        value={project.roof.rise}
        min={0}
        onCommit={(v) => commit('Change roof', (d) => void (d.roof.rise = v))}
      />
      <LengthField
        label={t('site.parapet')}
        value={project.roof.parapetHeight}
        min={0}
        onCommit={(v) => commit('Change roof', (d) => void (d.roof.parapetHeight = v))}
      />
      <ColorField
        label={t('site.roofColor')}
        value={project.roof.color}
        onCommit={(v) => commit('Change roof', (d) => void (d.roof.color = v))}
      />
      <ToggleField
        label={t('site.ridgeX')}
        value={project.roof.ridgeAlongX}
        onCommit={(v) => commit('Change roof', (d) => void (d.roof.ridgeAlongX = v))}
      />
    </Dialog>
  );
}

function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const prefs = useApp((s) => s.prefs);
  const store = useApp.getState();
  if (!project) return null;
  const s = project.settings;
  const unitOptions = LENGTH_UNITS.map((id) => ({ id, label: t(`unit.${id}`) }));
  const precisionOptions: { id: string; label: string }[] = [
    { id: 'eighth', label: t('precision.eighth') },
    { id: '0', label: '0' },
    { id: '1', label: '0.0' },
    { id: '2', label: '0.00' },
    { id: '3', label: '0.000' },
  ];
  return (
    <Dialog title={t('menu.settings')} onClose={onClose}>
      <SelectField<LengthUnit>
        label={t('settings.displayUnit')}
        testId="display-unit"
        value={s.displayUnit}
        options={unitOptions}
        onCommit={(displayUnit) => store.setPrefs({ displayUnit })}
      />
      <SelectField<LengthUnit>
        label={t('settings.secondaryUnit')}
        value={s.secondaryUnit}
        options={unitOptions}
        onCommit={(secondaryUnit) => store.setPrefs({ secondaryUnit })}
      />
      <SelectField
        label={t('settings.precision')}
        value={String(s.precision)}
        options={precisionOptions}
        onCommit={(v) =>
          store.commit(
            'Change precision',
            (d) => void (d.settings.precision = (v === 'eighth' ? 'eighth' : Number(v)) as DisplayPrecision),
          )
        }
      />
      <SelectField
        label={t('settings.angleUnit')}
        testId="angle-unit"
        value={s.angleUnit}
        options={
          [
            { id: 'deg', label: t('settings.degrees') },
            { id: 'rad', label: t('settings.radians') },
          ] as { id: 'deg' | 'rad'; label: string }[]
        }
        onCommit={(v) => store.commit('Change angle unit', (d) => void (d.settings.angleUnit = v))}
      />
      <SelectField
        label={t('settings.currency')}
        testId="currency"
        value={s.currency}
        options={CURRENCIES.map((id) => ({ id, label: id }))}
        onCommit={(v) => store.commit('Change currency', (d) => void (d.settings.currency = v))}
      />
      <p className="hint">{t('settings.currencyHint')}</p>
      <SelectField
        label={t('settings.language')}
        value={prefs.language}
        options={LANGUAGES}
        onCommit={(language) => store.setPrefs({ language })}
      />
      <SelectField
        label={t('settings.theme')}
        value={prefs.theme}
        options={(['light', 'dark', 'outdoor'] as ThemeName[]).map((id) => ({ id, label: t(`theme.${id}`) }))}
        onCommit={(theme) => store.setPrefs({ theme })}
      />
    </Dialog>
  );
}

function ProjectDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const commit = useApp((s) => s.commit);
  if (!project) return null;
  return (
    <Dialog title={t('project.title')} onClose={onClose}>
      <TextField
        label={t('common.name')}
        value={project.name}
        testId="project-rename"
        onCommit={(v) => commit('Rename project', (d) => void (d.name = v))}
      />
      <TextField
        label={t('project.tags')}
        value={project.tags.join(', ')}
        onCommit={(v) =>
          commit(
            'Change tags',
            (d) =>
              void (d.tags = v
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)),
          )
        }
      />
      <div className="field">
        <span className="row-label">{t('project.notes')}</span>
        <textarea
          className="input"
          rows={5}
          defaultValue={project.notes}
          onBlur={(e) => commit('Change notes', (d) => void (d.notes = e.target.value))}
        />
      </div>
    </Dialog>
  );
}

function HistoryList({ onClose }: { onClose: () => void }) {
  const t = useT();
  const history = useApp((s) => s.history);
  const lang = useApp((s) => s.prefs.language);
  const store = useApp.getState();
  const past = [...history.past].reverse();
  return (
    <Dialog title={t('menu.history')} onClose={onClose}>
      <p className="muted small">{t('history.help')}</p>
      <ol className="history-list" data-testid="history-list">
        {history.future
          .slice()
          .reverse()
          .map((e, i) => (
            <li key={e.id} className="future">
              <button
                className="btn menu-item"
                onClick={() => {
                  for (let k = 0; k < history.future.length - i; k++) useApp.getState().redoLatest();
                }}
              >
                {translateText(lang, e.name)}
              </button>
            </li>
          ))}
        <li className="now">{t('history.now')}</li>
        {past.map((e, i) => (
          <li key={e.id}>
            <button
              className="btn menu-item"
              onClick={() => {
                for (let k = 0; k <= i; k++) store.undoLatest();
              }}
            >
              {translateText(lang, e.name)}
              <span className="muted small"> {new Date(e.at).toLocaleTimeString()}</span>
            </button>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

function compareProjects(a: Project, b: Project) {
  const stats = (p: Project) => ({
    floors: p.floors.length,
    walls: p.floors.reduce((s, f) => s + f.walls.length, 0),
    rooms: p.floors.reduce((s, f) => s + f.rooms.length, 0),
    openings: p.floors.reduce((s, f) => s + f.openings.length, 0),
    objects: p.floors.reduce((s, f) => s + f.objects.length, 0),
    area: p.floors.reduce((s, f) => s + f.rooms.reduce((r, x) => r + x.area, 0), 0),
  });
  return { then: stats(a), now: stats(b) };
}

function Versions({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const [list, setList] = useState<Snapshot[]>([]);
  const [name, setName] = useState('');
  const [compare, setCompare] = useState<Snapshot | null>(null);
  const store = useApp.getState();
  const refresh = () => {
    if (project) void listSnapshots(project.id).then(setList);
  };
  useEffect(refresh, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project) return null;
  const diff = compare ? compareProjects(compare.project, project) : null;
  return (
    <Dialog title={t('menu.versions')} onClose={onClose} wide>
      <div className="field-line">
        <input
          className="input"
          data-testid="version-name"
          placeholder={t('versions.placeholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              document.querySelector<HTMLButtonElement>('[data-testid="version-save"]')?.click();
            }
          }}
        />
        <button
          className="btn primary"
          data-testid="version-save"
          onClick={() =>
            void addSnapshot(project, name.trim() || new Date().toLocaleString(), 'manual').then(() => {
              setName('');
              refresh();
            })
          }
        >
          {t('versions.save')}
        </button>
      </div>
      {!list.length ? <p className="muted">{t('versions.none')}</p> : null}
      <ul className="version-list" data-testid="version-list">
        {list.map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong>
            <span className="muted small">
              {t(`versions.${s.kind}`)} · {new Date(s.at).toLocaleString()}
            </span>
            <div className="row-actions">
              <button
                className="btn small"
                data-testid="version-restore"
                onClick={() => {
                  store.commit(`Restore ${s.name}`, (d) => {
                    Object.assign(d, JSON.parse(JSON.stringify(s.project)), { updatedAt: Date.now() });
                  });
                  store.setFloor(s.project.floors[0]?.id ?? '');
                  onClose();
                }}
              >
                {t('versions.restore')}
              </button>
              <button className="btn small" data-testid="version-compare" onClick={() => setCompare(s)}>
                {t('versions.compare')}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const copy: Project = {
                    ...(JSON.parse(JSON.stringify(s.project)) as Project),
                    id: newId(),
                    name: `${project.name} - ${s.name}`,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  };
                  void saveProject(copy).then(() => store.showToast(t('versions.duplicated')));
                }}
              >
                {t('common.duplicate')}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const next = window.prompt(t('common.rename'), s.name);
                  if (next) void renameSnapshot(s.id, next).then(refresh);
                }}
              >
                {t('common.rename')}
              </button>
              <button className="btn small danger" onClick={() => void deleteSnapshot(s.id).then(refresh)}>
                {t('action.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {diff ? (
        <table className="table" data-testid="version-diff">
          <thead>
            <tr>
              <th />
              <th>{compare?.name}</th>
              <th>{t('versions.current')}</th>
            </tr>
          </thead>
          <tbody>
            {(['floors', 'walls', 'rooms', 'openings', 'objects'] as const).map((k) => (
              <tr key={k}>
                <td>{t(`versions.stat.${k}`)}</td>
                <td className="num">{diff.then[k]}</td>
                <td className="num">{diff.now[k]}</td>
              </tr>
            ))}
            <tr>
              <td>{t('versions.stat.area')}</td>
              <td className="num">{diff.then.area.toFixed(1)}</td>
              <td className="num">{diff.now.area.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </Dialog>
  );
}

type ConverterKind = 'length' | 'area' | 'volume' | 'weight';

/** The site unit converter: length, area, volume and weight, including Indian land units. */
export function UnitConverter() {
  const t = useT();
  const [kind, setKind] = useState<ConverterKind>('length');
  const [text, setText] = useState('1');
  const [bigha, setBigha] = useState('default');
  const [unit, setUnit] = useState<string>('ft');

  useEffect(() => {
    setUnit(kind === 'length' ? 'ft' : kind === 'area' ? 'sqft' : kind === 'volume' ? 'cuft' : 'kg');
  }, [kind]);

  const rows = useMemo(() => {
    if (kind === 'length') {
      const parsed = parseLength(text, unit as LengthUnit);
      if (!parsed.ok) return { hint: t('units.badLength'), list: [] as string[] };
      return {
        hint: '',
        list: LENGTH_UNITS.map((u) =>
          u === 'ftin'
            ? formatLength(parsed.value, 'ftin', 'eighth')
            : `${round(convertLength(parsed.value, 'mm', u))} ${u}`,
        ),
      };
    }
    if (kind === 'area') {
      const sqm = parseArea(text, unit as AreaUnit, BIGHA_VARIANTS[bigha]);
      if (!sqm.ok) return { hint: t('converter.badNumber'), list: [] as string[] };
      return {
        hint: '',
        list: AREA_UNITS.map(
          (u) => `${round(convertArea(sqm.value, 'sqm', u, BIGHA_VARIANTS[bigha]))} ${AREA_LABEL[u]}`,
        ),
      };
    }
    if (kind === 'volume') {
      const cum = parseVolume(text, unit as VolumeUnit);
      if (!cum.ok) return { hint: t('converter.badNumber'), list: [] as string[] };
      return {
        hint: '',
        list: VOLUME_UNITS.map((u) => `${round(convertVolume(cum.value, 'cum', u))} ${VOLUME_LABEL[u]}`),
      };
    }
    const kg = parseWeight(text, unit as WeightUnit);
    if (!kg.ok) return { hint: t('converter.badNumber'), list: [] as string[] };
    return {
      hint: '',
      list: WEIGHT_UNITS.map((u) => `${round(convertWeight(kg.value, 'kg', u))} ${WEIGHT_LABEL[u]}`),
    };
  }, [kind, text, unit, bigha, t]);

  const options: { id: string; label: string }[] =
    kind === 'length'
      ? LENGTH_UNITS.map((id) => ({ id, label: t(`unit.${id}`) }))
      : kind === 'area'
        ? AREA_UNITS.map((id) => ({ id, label: AREA_LABEL[id] }))
        : kind === 'volume'
          ? VOLUME_UNITS.map((id) => ({ id, label: VOLUME_LABEL[id] }))
          : WEIGHT_UNITS.map((id) => ({ id, label: WEIGHT_LABEL[id] }));

  return (
    <div data-testid="converter">
      <div className="tabs">
        {(['length', 'area', 'volume', 'weight'] as ConverterKind[]).map((k) => (
          <button
            key={k}
            className={k === kind ? 'tab active' : 'tab'}
            data-testid={`converter-${k}`}
            onClick={() => setKind(k)}
          >
            {t(`converter.${k}`)}
          </button>
        ))}
      </div>
      <div className="field-line">
        <input
          className="input"
          data-testid="converter-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select
          className="unit-select"
          data-testid="converter-unit"
          aria-label={t('converter.unit')}
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {kind === 'area' ? (
        <SelectField
          label={t('converter.bigha')}
          value={bigha}
          options={Object.keys(BIGHA_VARIANTS).map((id) => ({ id, label: t(`bigha.${id}`, id) }))}
          onCommit={setBigha}
        />
      ) : null}
      {rows.hint ? <p className="preview error">{rows.hint}</p> : null}
      <ul className="converter-list" data-testid="converter-results">
        {rows.list.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function round(n: number): string {
  if (n === 0) return '0';
  const digits = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 3 : 5;
  return Number(n.toFixed(digits)).toString();
}
