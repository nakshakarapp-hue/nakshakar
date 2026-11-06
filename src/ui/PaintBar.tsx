import { useT } from '../app/i18n';
import { useApp } from '../app/store';
import { PAINTS, type PaintTarget } from '../catalog/paints';

/** Colour chart shared by the 2D paint tool and the 3D view. */
export function PaintBar({ compact }: { compact?: boolean }) {
  const t = useT();
  const paint = useApp((s) => s.paint);
  const setPaint = useApp((s) => s.setPaint);
  return (
    <div className="paint-bar" data-testid="paint-bar">
      {!compact ? (
        <div className="tabs paint-targets">
          {(['walls', 'outside', 'floor', 'ceiling'] as PaintTarget[]).map((id) => (
            <button
              key={id}
              className={paint.target === id ? 'tab small-tab active' : 'tab small-tab'}
              data-testid={`paint-target-${id}`}
              onClick={() => setPaint({ target: id })}
            >
              {t(`paint.${id}`)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="swatches">
        {PAINTS.map((p) => (
          <button
            key={p.id}
            className={paint.color === p.hex ? 'swatch active' : 'swatch'}
            style={{ background: p.hex }}
            title={t(`paintname.${p.id}`, p.name)}
            aria-label={t(`paintname.${p.id}`, p.name)}
            aria-pressed={paint.color === p.hex}
            data-testid={`paint-${p.id}`}
            onClick={() => setPaint({ color: p.hex })}
          />
        ))}
        <label className="swatch custom" title={t('paint.custom')}>
          <span aria-hidden="true">＋</span>
          <input
            type="color"
            aria-label={t('paint.custom')}
            value={paint.color}
            onChange={(e) => setPaint({ color: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
