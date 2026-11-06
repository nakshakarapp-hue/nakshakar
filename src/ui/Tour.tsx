import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useT } from '../app/i18n';
import { useApp } from '../app/store';

/**
 * A guided first run, the way games teach: a dimmed screen with one control lit, a short line saying
 * what it does, and the step moves on only when that control is tapped. Steps that only explain have a
 * Next button. The first visible element in `targets` is the one lit, so a step works on a laptop and a
 * phone alike.
 */
interface Step {
  id: string;
  targets: string[];
  /** 'tap': goes on once the lit control is tapped. 'next': explains, with a Next button. */
  wait: 'tap' | 'next';
  /** Skipped when none of its targets is on screen, such as a panel already closed. */
  optional?: boolean;
}

const STEPS: Step[] = [
  { id: 'rooms', targets: ['tool-rooms', 'nav-rooms'], wait: 'tap' },
  { id: 'roomType', targets: ['room-types'], wait: 'next' },
  { id: 'roomAdd', targets: ['room-add'], wait: 'tap' },
  { id: 'roomMore', targets: ['room-add'], wait: 'tap' },
  { id: 'roomsDone', targets: ['rooms-done'], wait: 'tap', optional: true },
  { id: 'add', targets: ['tool-all', 'nav-add'], wait: 'tap' },
  { id: 'library', targets: ['library-tabs'], wait: 'next', optional: true },
  { id: 'libraryClose', targets: ['dialog-done'], wait: 'tap', optional: true },
  { id: 'select', targets: ['plan-canvas'], wait: 'next' },
  { id: 'undo', targets: ['undo'], wait: 'next' },
  { id: 'three', targets: ['go-3d', 'fab-3d'], wait: 'next' },
  { id: 'explore', targets: ['go-explore', 'fab-explore'], wait: 'next' },
];

const PAD = 6;

function visible(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

export function Tour({ onEnd }: { onEnd: () => void }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[index];

  const finish = useCallback(() => {
    useApp.getState().setPrefs({ tourDone: true });
    onEnd();
  }, [onEnd]);

  const next = useCallback(() => {
    setRect(null);
    setIndex((i) => {
      if (i + 1 >= STEPS.length) {
        finish();
        return i;
      }
      return i + 1;
    });
  }, [finish]);

  // Follow the lit control as panels open and the screen changes size.
  useLayoutEffect(() => {
    if (!step) return;
    let missing = 0;
    const find = () => {
      const el = step.targets.map(visible).find(Boolean);
      if (el) {
        missing = 0;
        const r = el.getBoundingClientRect();
        setRect((old) =>
          old && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height ? old : r,
        );
      } else {
        missing += 1;
        // A step whose control never appears is passed over rather than leaving the guide stuck.
        if (missing > (step.optional ? 3 : 25)) next();
      }
    };
    find();
    const id = setInterval(find, 200);
    window.addEventListener('resize', find);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', find);
    };
  }, [step, next]);

  // A tap on the lit control moves the guide on, after the app has had its turn to respond.
  useEffect(() => {
    if (!step || step.wait !== 'tap') return;
    const onClick = (e: MouseEvent) => {
      const el = step.targets.map(visible).find(Boolean);
      if (el && e.target instanceof Node && el.contains(e.target)) setTimeout(next, 250);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  if (!step || !rect) return null;
  const hole = {
    x: Math.max(0, rect.x - PAD),
    y: Math.max(0, rect.y - PAD),
    w: rect.width + PAD * 2,
    h: rect.height + PAD * 2,
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // A big target like the plan gets the note inside it, near the top.
  const big = hole.w * hole.h > vw * vh * 0.35;
  const below = big || hole.y + hole.h + 170 < vh;
  const tipW = Math.min(320, vw - 24);
  const tipX = Math.max(12, Math.min(vw - tipW - 12, hole.x + hole.w / 2 - tipW / 2));
  const tipY = big ? hole.y + 24 : below ? hole.y + hole.h + 14 : Math.max(12, hole.y - 14);
  const blocker = (style: React.CSSProperties) => (
    <div className="tour-block" style={style} onClick={(e) => e.stopPropagation()} />
  );

  return (
    <div className="tour" data-testid="tour" data-step={step.id} role="dialog" aria-live="polite">
      {/* Four panes around the lit control: everything else waits until the guide is done. */}
      {step.wait === 'tap' ? (
        <>
          {blocker({ left: 0, top: 0, width: vw, height: hole.y })}
          {blocker({ left: 0, top: hole.y + hole.h, width: vw, height: Math.max(0, vh - hole.y - hole.h) })}
          {blocker({ left: 0, top: hole.y, width: hole.x, height: hole.h })}
          {blocker({
            left: hole.x + hole.w,
            top: hole.y,
            width: Math.max(0, vw - hole.x - hole.w),
            height: hole.h,
          })}
        </>
      ) : (
        blocker({ left: 0, top: 0, width: vw, height: vh, background: 'transparent' })
      )}
      <div
        className={step.wait === 'tap' ? 'tour-hole pulse' : 'tour-hole'}
        style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
      />
      <div
        className="tour-tip"
        style={{
          left: tipX,
          width: tipW,
          top: below ? tipY : undefined,
          bottom: below ? undefined : vh - tipY,
        }}
      >
        <span className="tour-count">
          {index + 1} / {STEPS.length}
        </span>
        <p>{t(`tour.${step.id}`)}</p>
        <div className="tour-actions">
          <button className="btn ghost" data-testid="tour-skip" onClick={finish}>
            {t('tour.skip')}
          </button>
          {step.wait === 'next' ? (
            <button className="btn primary" data-testid="tour-next" onClick={next}>
              {index + 1 >= STEPS.length ? t('tour.finish') : t('tour.next')}
            </button>
          ) : (
            <span className="tour-tap">{t('tour.tapHint')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
