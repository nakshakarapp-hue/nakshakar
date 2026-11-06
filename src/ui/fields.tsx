import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../app/i18n';
import { useApp } from '../app/store';
import type { LengthUnit } from '../core/model/types';
import { LENGTH_UNITS, formatLength, lengthInputText, parseAngle, parseLength } from '../core/units';

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="row">
      <span className="row-label">{label}</span>
      <span className="row-body">{children}</span>
      {hint ? <span className="row-hint">{hint}</span> : null}
    </label>
  );
}

const UNIT_LABEL: Record<LengthUnit, string> = {
  ftin: 'ft\' in"',
  ft: 'ft',
  in: 'in',
  m: 'm',
  cm: 'cm',
  mm: 'mm',
  yd: 'yd',
  gaj: 'gaj',
  hath: 'hath',
};

/**
 * The smart length input: understands 12, 12'6, 3.2m, 5 1/2 in and so on. A unit dropdown sits beside it,
 * typing an explicit unit overrides that, and the live preview shows the secondary unit underneath.
 */
export function LengthField({
  label,
  value,
  onCommit,
  min,
  testId,
  autoFocus,
  onEnter,
  live,
  seed,
}: {
  /** Text already typed, when typing is what opened this box. */
  seed?: string;
  label: string;
  value: number;
  onCommit: (mm: number) => void;
  min?: number;
  testId?: string;
  autoFocus?: boolean;
  /** Called with the value when Enter is pressed, for fields where Enter means "add this". */
  onEnter?: (mm: number) => void;
  /** Commits on every valid keystroke, so previews update as the user types. */
  live?: boolean;
}) {
  const t = useT();
  const settings = useApp((s) => s.project?.settings);
  const prefs = useApp((s) => s.prefs);
  const displayUnit = settings?.displayUnit ?? prefs.displayUnit;
  const secondary = settings?.secondaryUnit ?? prefs.secondaryUnit;
  const [unit, setUnit] = useState<LengthUnit>(displayUnit);
  const [text, setText] = useState(() => seed || lengthInputText(value, displayUnit));
  const [focused, setFocused] = useState(false);

  useEffect(() => setUnit(displayUnit), [displayUnit]);
  // Until the box has had focus, what was typed to open it must not be replaced by the stored value.
  const keepSeed = useRef(Boolean(seed));
  // Only what was typed is saved. A box left focused while the item is dragged on the plan would
  // otherwise put back its old number when it loses focus.
  const edited = useRef(Boolean(seed));
  useEffect(() => {
    if ((!focused || !edited.current) && !keepSeed.current) setText(lengthInputText(value, unit));
  }, [value, unit, focused]);

  const parsed = parseLength(text, unit);
  const below = parsed.ok && min !== undefined && parsed.value < min;
  const commit = () => {
    const typed = edited.current;
    edited.current = false;
    if (typed && parsed.ok && !below && Math.abs(parsed.value - value) > 0.01) onCommit(parsed.value);
    else setText(lengthInputText(value, unit));
  };

  return (
    <div className="field">
      <span className="row-label">{label}</span>
      <div className="field-line">
        <input
          data-testid={testId}
          className={parsed.ok && !below ? 'input' : 'input bad'}
          value={text}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          onFocus={(e) => {
            setFocused(true);
            if (!seed) e.target.select();
          }}
          onBlur={() => {
            keepSeed.current = false;
            setFocused(false);
            commit();
          }}
          onChange={(e) => {
            edited.current = true;
            setText(e.target.value);
            if (!live) return;
            const next = parseLength(e.target.value, unit);
            if (next.ok && (min === undefined || next.value >= min)) onCommit(next.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (onEnter && parsed.ok && !below) {
              e.preventDefault();
              if (edited.current && Math.abs(parsed.value - value) > 0.01) onCommit(parsed.value);
              edited.current = false;
              onEnter(parsed.value);
            } else {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <select
          className="unit-select"
          aria-label={label}
          value={unit}
          onChange={(e) => setUnit(e.target.value as LengthUnit)}
        >
          {LENGTH_UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </div>
      <span className={parsed.ok && !below ? 'preview' : 'preview error'}>
        {!parsed.ok
          ? t('units.badLength')
          : below
            ? `${t('units.minimum')} ${formatLength(min!, unit, 2)}`
            : `= ${formatLength(parsed.value, secondary, 2)}`}
      </span>
    </div>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  suffix,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const edited = useRef(false);
  useEffect(() => {
    if (!focused || !edited.current) setText(String(Math.round(value * 1000) / 1000));
  }, [value, focused]);
  const n = Number(text);
  const ok =
    text.trim() !== '' &&
    Number.isFinite(n) &&
    (min === undefined || n >= min) &&
    (max === undefined || n <= max);
  return (
    <div className="field">
      <span className="row-label">{label}</span>
      <div className="field-line">
        <input
          className={ok ? 'input' : 'input bad'}
          type="text"
          inputMode="decimal"
          step={step}
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setFocused(false);
            const typed = edited.current;
            edited.current = false;
            if (typed && ok && n !== value) onCommit(n);
            else setText(String(Math.round(value * 1000) / 1000));
          }}
          onChange={(e) => {
            edited.current = true;
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {suffix ? <span className="suffix">{suffix}</span> : null}
      </div>
    </div>
  );
}

export function AngleField({
  label,
  value,
  onCommit,
  testId,
  onEnter,
  live,
}: {
  label: string;
  value: number;
  onCommit: (deg: number) => void;
  testId?: string;
  onEnter?: (deg: number) => void;
  live?: boolean;
}) {
  const t = useT();
  const radians = useApp((s) => s.project?.settings.angleUnit === 'rad');
  // Stored and calculated in degrees; radians are only how the value is typed and shown.
  const toShown = (deg: number) =>
    radians ? Math.round((deg * Math.PI * 1000) / 180) / 1000 : Math.round(deg * 100) / 100;
  const toDegrees = (shown: number) => (radians ? (shown * 180) / Math.PI : shown);
  const [text, setText] = useState(String(toShown(value)));
  const [focused, setFocused] = useState(false);
  const edited = useRef(false);
  useEffect(() => {
    if (!focused || !edited.current) setText(String(toShown(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, radians]);
  const parsed = parseAngle(text);
  return (
    <div className="field">
      <span className="row-label">{label}</span>
      <div className="field-line">
        <input
          data-testid={testId}
          className={parsed.ok ? 'input' : 'input bad'}
          value={text}
          inputMode="decimal"
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setFocused(false);
            const typed = edited.current;
            edited.current = false;
            if (typed && parsed.ok) onCommit(toDegrees(parsed.value));
            else setText(String(toShown(value)));
          }}
          onChange={(e) => {
            edited.current = true;
            setText(e.target.value);
            if (!live) return;
            const next = parseAngle(e.target.value);
            if (next.ok) onCommit(toDegrees(next.value));
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (onEnter && parsed.ok) {
              e.preventDefault();
              if (edited.current) onCommit(toDegrees(parsed.value));
              edited.current = false;
              onEnter(toDegrees(parsed.value));
            } else {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="suffix">{radians ? 'rad' : '°'}</span>
      </div>
      {!parsed.ok ? <span className="preview error">{t('units.badAngle')}</span> : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onCommit,
  testId,
  autoFocus,
}: {
  label: string;
  value: string;
  onCommit: (s: string) => void;
  testId?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value);
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current) setText(value);
  }, [value]);
  return (
    <div className="field">
      <span className="row-label">{label}</span>
      <input
        data-testid={testId}
        className="input"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          edited.current = true;
          setText(e.target.value);
        }}
        onBlur={() => {
          const typed = edited.current;
          edited.current = false;
          if (typed && text !== value) onCommit(text);
          else setText(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export function ColorField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (c: string) => void;
}) {
  const [c, setC] = useState(value);
  useEffect(() => setC(value), [value]);
  return (
    <div className="field">
      <span className="row-label">{label}</span>
      <div className="field-line">
        <input
          className="color"
          type="color"
          aria-label={label}
          value={/^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff'}
          onChange={(e) => setC(e.target.value)}
          onBlur={() => {
            if (c !== value) onCommit(c);
          }}
        />
        <span className="suffix">{c}</span>
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onCommit: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="field">
      <span className="row-label">{label}</span>
      <select
        data-testid={testId}
        className="input"
        value={value}
        onChange={(e) => onCommit(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ToggleField({
  label,
  value,
  onCommit,
  testId,
}: {
  label: string;
  value: boolean;
  onCommit: (b: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="toggle">
      <input
        data-testid={testId}
        type="checkbox"
        checked={value}
        onChange={(e) => onCommit(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const t = useT();
  // One listener for the dialog's whole life: swapping it during a re-render could lose the key press.
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latestClose.current();
      if (e.key !== 'Enter') return;
      // Enter goes to the next box, like a form on paper. From the last box it presses the main button.
      const el = e.target as HTMLElement;
      if (['BUTTON', 'TEXTAREA', 'SELECT', 'A', 'SUMMARY'].includes(el.tagName)) return;
      const boxes = [...document.querySelectorAll<HTMLInputElement>('.dialog-body input')].filter(
        (x) => !['checkbox', 'radio', 'color', 'file'].includes(x.type) && !x.disabled,
      );
      const next = boxes[boxes.indexOf(el as HTMLInputElement) + 1];
      setTimeout(() => {
        if (el.tagName === 'INPUT' && next) {
          next.focus();
          next.select();
        } else {
          document
            .querySelector<HTMLButtonElement>(
              '.dialog-foot .btn.primary:not(:disabled):not([data-auto-done])',
            )
            ?.click();
        }
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="dialog-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'dialog wide' : 'dialog'} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button
            className="btn ghost"
            onClick={onClose}
            aria-label={t('common.close')}
            title={`${t('common.close')} (Esc)`}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-foot">
          {footer ?? (
            <button className="btn primary" data-testid="dialog-done" data-auto-done="true" onClick={onClose}>
              {t('common.done')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function RangeCells({
  min,
  likely,
  max,
  format,
}: {
  min: number;
  likely: number;
  max: number;
  format: (n: number) => string;
}) {
  return (
    <>
      <td className="num">{format(min)}</td>
      <td className="num strong">{format(likely)}</td>
      <td className="num">{format(max)}</td>
    </>
  );
}
