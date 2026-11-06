import { ArrowLeft, CircleAlert, CircleCheck, CircleMinus, CircleX, type LucideIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useMemo, useState } from 'react';
import { translateTemplate, translateText, useT } from '../app/i18n';
import { useApp } from '../app/store';
import { formatIndian } from '../core/units';
import { currencySymbol, formatMoney } from '../estimate/money';
import { estimateProject, type Range } from '../estimate/estimate';
import { RATE_DEFS, rateDefByKey } from '../estimate/rates';
import { buildPdf, floorSvg, type PaperScale, type PaperSize } from '../print/pdf';
import { shareOrDownload } from '../print/share';
import { assessVastu, type VastuStatus } from '../vastu/rules';
import { NumberField, RangeCells, SelectField, ToggleField } from './fields';

function ScreenFrame({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  const t = useT();
  const go = useApp((s) => s.go);
  return (
    <div className="report-screen" data-testid={testId}>
      <header className="topbar">
        <button
          className="btn ghost"
          data-testid="back-editor"
          aria-label={t('common.back')}
          onClick={() => go('editor')}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1 className="report-title">{title}</h1>
      </header>
      <div className="report-body">{children}</div>
    </div>
  );
}

const STATUS_ICON: Record<VastuStatus, LucideIcon> = {
  good: CircleCheck,
  okay: CircleAlert,
  poor: CircleX,
  na: CircleMinus,
};

export function VastuScreen() {
  const t = useT();
  const project = useApp((s) => s.project);
  const commit = useApp((s) => s.commit);
  const lang = useApp((s) => s.prefs.language);
  const report = useMemo(() => (project ? assessVastu(project) : null), [project]);
  if (!project || !report) return null;
  const ignored = new Set(project.vastu.ignoredRules);
  const row = (f: (typeof report.findings)[number], i: number) => {
    const Icon = STATUS_ICON[f.status];
    return (
      <li key={`${f.ruleId}-${i}`} className={`finding status-${f.status}`}>
        <span className="finding-icon" aria-label={t(`vastu.status.${f.status}`)}>
          <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="finding-body">
          <strong>{t(`vastu.${f.ruleId}`, f.title)}</strong>
          <span className="small">
            {f.floor ? `${translateText(lang, f.floor)}: ` : ''}
            {translateTemplate(lang, f.template, f.vars)}
          </span>
          {f.suggestion ? (
            <span className="small suggestion">{translateText(lang, f.suggestion)}</span>
          ) : null}
          <ToggleField
            label={t('vastu.ignore')}
            value={ignored.has(f.ruleId)}
            onCommit={(v) =>
              commit('Change Vastu rules', (d) => {
                d.vastu.ignoredRules = v
                  ? [...new Set([...d.vastu.ignoredRules, f.ruleId])]
                  : d.vastu.ignoredRules.filter((r) => r !== f.ruleId);
              })
            }
          />
        </div>
      </li>
    );
  };
  const count = (status: VastuStatus) => report.findings.filter((f) => f.status === status).length;
  const attention = report.findings.filter((f) => f.status === 'poor' || f.status === 'okay');
  const fine = report.findings.filter((f) => f.status !== 'poor' && f.status !== 'okay');
  return (
    <ScreenFrame title={t('menu.vastu')} testId="vastu-screen">
      <section className="card score-card">
        <div className={`score band-${report.band}`} data-testid="vastu-score">
          {report.score ?? '–'}
          <span className="small">/100</span>
        </div>
        <div>
          <h2>{t(`vastu.band.${report.band}`)}</h2>
          <div className="count-row">
            {(['good', 'okay', 'poor'] as const).map((k) => (
              <span key={k} className={k}>
                <b>{count(k)}</b> {t(`vastu.status.${k}`)}
              </span>
            ))}
          </div>
          <p className="muted small">{t('vastu.disclaimer')}</p>
        </div>
      </section>
      <div data-testid="vastu-findings">
        <h3 className="finding-section">{t('vastu.attention')}</h3>
        <ul className="finding-list">{attention.map(row)}</ul>
        <details>
          <summary className="finding-section">
            {t('vastu.fine')} ({fine.length})
          </summary>
          <ul className="finding-list">{fine.map(row)}</ul>
        </details>
      </div>
    </ScreenFrame>
  );
}

const amount = (n: number) => (n >= 100 ? formatIndian(n) : n.toFixed(n >= 10 ? 1 : 2));
const days = (n: number) => `${Math.round(n)}`;

function RangeRow({
  label,
  r,
  format,
  testId,
}: {
  label: string;
  r: Range;
  format: (n: number) => string;
  testId?: string;
}) {
  return (
    <tr data-testid={testId}>
      <td>{label}</td>
      <RangeCells min={r.min} likely={r.likely} max={r.max} format={format} />
    </tr>
  );
}

interface Range3 {
  min: number;
  likely: number;
  max: number;
}

/**
 * Cost of each stage as a bar: the solid part is the likely cost, the pale part how much higher it
 * could go. One colour, values in plain text beside each bar, the full range on hover; the table
 * below gives the exact figures.
 */
function StageBars({
  rows,
  format,
  rangeLabel,
}: {
  rows: { label: string; r: Range3 }[];
  format: (n: number) => string;
  rangeLabel: (r: Range3) => string;
}) {
  const top = Math.max(1, ...rows.map((x) => x.r.max));
  return (
    <ul className="stage-bars" data-testid="stage-bars">
      {rows.map(({ label, r }) => (
        <li key={label} title={rangeLabel(r)}>
          <span className="stage-name">{label}</span>
          <span className="stage-track">
            <span className="stage-spread" style={{ width: `${(100 * r.max) / top}%` }} />
            <span className="stage-likely" style={{ width: `${(100 * r.likely) / top}%` }} />
          </span>
          <span className="stage-value">{format(r.likely)}</span>
        </li>
      ))}
    </ul>
  );
}

export function EstimateScreen() {
  const t = useT();
  const project = useApp((s) => s.project);
  const commit = useApp((s) => s.commit);
  const lang = useApp((s) => s.prefs.language);
  const estimate = useMemo(() => (project ? estimateProject(project) : null), [project]);
  const currency = project?.settings.currency ?? 'INR';
  const rupees = (n: number) => formatMoney(n, currency);
  const tr = (text: string) => translateText(lang, text);
  const [tab, setTab] = useState<'summary' | 'materials' | 'schedule' | 'rates' | 'details'>('summary');
  if (!project || !estimate) return null;
  const set = (patch: Partial<typeof project.estimate>) =>
    commit('Change estimate settings', (d) => Object.assign(d.estimate, patch));
  const Head = ({ first }: { first: string }) => (
    <thead>
      <tr>
        <th>{first}</th>
        <th className="num">{t('estimate.min')}</th>
        <th className="num">{t('estimate.likely')}</th>
        <th className="num">{t('estimate.max')}</th>
      </tr>
    </thead>
  );
  return (
    <ScreenFrame title={t('menu.estimate')} testId="estimate-screen">
      {estimate.isEmpty ? <p className="banner">{t('estimate.empty')}</p> : null}
      <div className="tabs">
        {(['summary', 'materials', 'schedule', 'rates', 'details'] as const).map((k) => (
          <button
            key={k}
            className={k === tab ? 'tab active' : 'tab'}
            data-testid={`estimate-tab-${k}`}
            onClick={() => setTab(k)}
          >
            {t(`estimate.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <>
          <section className="card">
            <div className="figures" data-testid="estimate-total">
              {(
                [
                  ['min', 'estimate.min'],
                  ['likely', 'estimate.likely'],
                  ['max', 'estimate.max'],
                ] as const
              ).map(([k, key]) => (
                <div key={k} className={k === 'likely' ? 'figure main' : 'figure'}>
                  <span>{t(key)}</span>
                  <strong>{rupees(estimate.total[k])}</strong>
                  <small>
                    {rupees(estimate.perSqft[k])}/sq ft · {days(estimate.totalDays[k])} {t('estimate.days')}
                  </small>
                </div>
              ))}
            </div>
            {/* Where the likely cost sits between the lowest and highest it could reasonably be. */}
            <div
              className="range-bar"
              role="img"
              aria-label={`${t('estimate.min')} ${rupees(estimate.total.min)}, ${t('estimate.likely')} ${rupees(estimate.total.likely)}, ${t('estimate.max')} ${rupees(estimate.total.max)}`}
            >
              <div className="range-track">
                <span
                  className="range-mark"
                  style={{
                    left: `${Math.round(
                      (100 * (estimate.total.likely - estimate.total.min)) /
                        Math.max(1, estimate.total.max - estimate.total.min),
                    )}%`,
                  }}
                />
              </div>
            </div>
            <p className="muted small">
              {t('estimate.builtUp')}: {estimate.builtUpSqm.toFixed(1)} sq m (
              {(estimate.builtUpSqm * 10.7639).toFixed(0)} sq ft) · {t('estimate.carpet')}:{' '}
              {estimate.carpetSqm.toFixed(1)} sq m
            </p>
            {estimate.defaultRatesUsed.length ? (
              <p className="banner notice" data-testid="default-rates-warning">
                {t('estimate.defaultRatesHelp')} ({estimate.defaultRatesUsed.length})
                <button className="btn small" onClick={() => setTab('rates')}>
                  {t('estimate.tab.rates')}
                </button>
              </p>
            ) : null}
          </section>
          <section className="card">
            <h2>{t('estimate.options')}</h2>
            <div className="settings-grid">
              <SelectField
                label={t('estimate.quality')}
                testId="estimate-quality"
                value={project.estimate.quality}
                options={(['economy', 'standard', 'premium'] as const).map((id) => ({
                  id,
                  label: t(`quality.${id}`),
                }))}
                onCommit={(quality) => set({ quality })}
              />
              <SelectField
                label={t('estimate.foundation')}
                value={project.estimate.foundation}
                options={(['isolated', 'strip', 'raft'] as const).map((id) => ({
                  id,
                  label: t(`foundation.${id}`),
                }))}
                onCommit={(foundation) => set({ foundation })}
              />
              <SelectField
                label={t('estimate.cement')}
                value={project.estimate.cementType}
                options={(['OPC', 'PPC'] as const).map((id) => ({ id, label: id }))}
                onCommit={(cementType) => set({ cementType })}
              />
              <NumberField
                label={t('estimate.contingency')}
                value={project.estimate.contingencyPercent}
                min={0}
                max={50}
                suffix="%"
                onCommit={(contingencyPercent) => set({ contingencyPercent })}
              />
              <NumberField
                label={t('estimate.crew')}
                value={project.estimate.crewSize}
                min={1}
                max={100}
                onCommit={(crewSize) => set({ crewSize: Math.round(crewSize) })}
              />
            </div>
            <ToggleField
              label={t('estimate.includeInteriors')}
              testId="include-interiors"
              value={project.estimate.includeInteriors}
              onCommit={(includeInteriors) => set({ includeInteriors })}
            />
            <ToggleField
              label={t('estimate.includeCompound')}
              value={project.estimate.includeCompound}
              onCommit={(includeCompound) => set({ includeCompound })}
            />
          </section>
          <section className="card">
            <h2>{t('estimate.byStage')}</h2>
            <StageBars
              rows={estimate.stages.map((s) => ({ label: t(`stage.${s.stage}`, s.stage), r: s.cost }))}
              format={rupees}
              rangeLabel={(r) =>
                `${t('estimate.min')} ${rupees(r.min)} · ${t('estimate.likely')} ${rupees(r.likely)} · ${t('estimate.max')} ${rupees(r.max)}`
              }
            />
            <div className="table-scroll">
              <table className="table">
                <Head first={t('estimate.stage')} />
                <tbody>
                  {estimate.stages.map((s) => (
                    <RangeRow
                      key={s.stage}
                      label={t(`stage.${s.stage}`, s.stage)}
                      r={s.cost}
                      format={rupees}
                    />
                  ))}
                  <RangeRow label={t('estimate.contingency')} r={estimate.contingency} format={rupees} />
                  <RangeRow label={t('estimate.total')} r={estimate.total} format={rupees} />
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2>{t('estimate.assumptions')}</h2>
            <ul className="assumptions" data-testid="estimate-assumptions">
              {estimate.assumptions.map((a) => (
                <li key={a}>{tr(a)}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {tab === 'materials' ? (
        <section className="card">
          <div className="table-scroll">
            <table className="table" data-testid="estimate-materials">
              <Head first={t('estimate.material')} />
              <tbody>
                {estimate.materials.map((m) => (
                  <RangeRow
                    key={m.key}
                    label={`${t(`material.${m.key.replace('unit_', '')}`, m.name)} (${tr(m.unit)})`}
                    r={m.quantity}
                    format={amount}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'schedule' ? (
        <>
          <section className="card">
            <div className="table-scroll">
              <table className="table" data-testid="estimate-schedule">
                <Head first={t('estimate.task')} />
                <tbody>
                  {estimate.schedule.map((s) => (
                    <RangeRow key={s.id} label={t(`task.${s.id}`, s.name)} r={s.days} format={days} />
                  ))}
                  <RangeRow label={t('estimate.total')} r={estimate.totalDays} format={days} />
                </tbody>
              </table>
            </div>
            <p className="muted small">{t('estimate.scheduleNote')}</p>
          </section>
          <section className="card">
            <h2>{t('estimate.curing')}</h2>
            <div className="table-scroll">
              <table className="table" data-testid="estimate-curing">
                <thead>
                  <tr>
                    <th>{t('estimate.element')}</th>
                    <th className="num">{t('estimate.cureDays')}</th>
                    <th className="num">{t('estimate.stripDays')}</th>
                    <th>{t('estimate.notes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.curing.map((c) => (
                    <tr key={c.element}>
                      <td>{tr(c.element)}</td>
                      <td className="num">{`${days(c.cureDays.min)} - ${days(c.cureDays.max)}`}</td>
                      <td className="num">
                        {c.stripDays ? `${days(c.stripDays.min)} - ${days(c.stripDays.max)}` : '–'}
                      </td>
                      <td className="small">{tr(c.note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === 'rates' ? (
        <section className="card" data-testid="estimate-rates">
          <p className="muted small">
            {t('estimate.ratesHelp')} {t('estimate.ratesDot')}
          </p>
          {(['Materials', 'Labour', 'Finishes', 'Openings', 'Services', 'Interiors'] as const).map(
            (group) => (
              <div key={group}>
                <h3>{t(`rategroup.${group}`, group)}</h3>
                <div className="settings-grid">
                  {RATE_DEFS.filter((r) => r.group === group).map((r) => (
                    <NumberField
                      key={r.key}
                      label={`${t(`rate.${r.key}`, r.label)}${project.estimate.rates[r.key] === undefined ? ' •' : ''}`}
                      value={project.estimate.rates[r.key] ?? r.value}
                      min={0}
                      suffix={`${currencySymbol(currency)}/${tr(r.unit)}`}
                      onCommit={(v) =>
                        commit(
                          `Set rate: ${rateDefByKey.get(r.key)?.label}`,
                          (d) => void (d.estimate.rates[r.key] = v),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ),
          )}
          <button className="btn" onClick={() => commit('Reset rates', (d) => void (d.estimate.rates = {}))}>
            {t('estimate.resetRates')}
          </button>
        </section>
      ) : null}

      {tab === 'details' ? (
        <section className="card">
          <div className="table-scroll">
            <table className="table" data-testid="estimate-details">
              <thead>
                <tr>
                  <th>{t('estimate.item')}</th>
                  <th className="num">{t('estimate.quantity')}</th>
                  <th className="num">{t('estimate.min')}</th>
                  <th className="num">{t('estimate.likely')}</th>
                  <th className="num">{t('estimate.max')}</th>
                  <th>{t('estimate.basis')}</th>
                </tr>
              </thead>
              <tbody>
                {estimate.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{tr(l.name)}</td>
                    <td className="num">{`${amount(l.quantity.min)} – ${amount(l.quantity.max)} ${tr(l.unit)}`}</td>
                    <RangeCells min={l.cost.min} likely={l.cost.likely} max={l.cost.max} format={rupees} />
                    <td className="small">{tr(l.assumption)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </ScreenFrame>
  );
}

export function PrintScreen() {
  const t = useT();
  const project = useApp((s) => s.project);
  const showToast = useApp((s) => s.showToast);
  const lang = useApp((s) => s.prefs.language);
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [scale, setScale] = useState<string>('fit');
  const [includePlans, setPlans] = useState(true);
  const [includeSchedule, setSchedule] = useState(true);
  const [includeVastu, setVastu] = useState(true);
  const [includeEstimate, setEstimate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  if (!project) return null;

  const make = async () => {
    setBusy(true);
    setStatus('');
    try {
      const doc = await buildPdf(project, {
        paper,
        orientation,
        scale: (scale === 'fit' ? 'fit' : Number(scale)) as PaperScale,
        includePlans,
        includeSchedule,
        includeVastu,
        includeEstimate,
        label: (key, fallback) => t(key, fallback),
        text: (s) => translateText(lang, s),
        template: (template, vars) => translateTemplate(lang, template, vars),
      });
      const blob = doc.output('blob');
      await shareOrDownload(blob, `${project.name.replace(/[^\w.-]+/g, '_')}.pdf`);
      const pages = doc.getNumberOfPages();
      setStatus(t('print.done').replace('{n}', String(pages)));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
      setStatus(t('print.failed'));
    } finally {
      setBusy(false);
    }
  };

  const nativePrint = () => {
    // Android WebView has no window.print, so devices print the PDF through the share sheet instead.
    if (Capacitor.isNativePlatform()) {
      void make();
      return;
    }
    window.print();
  };

  return (
    <ScreenFrame title={t('menu.print')} testId="print-screen">
      <div className="print-layout">
        <section className="card no-print">
          <div className="settings-grid">
            <SelectField
              label={t('print.paper')}
              testId="print-paper"
              value={paper}
              options={
                [
                  { id: 'a4', label: 'A4' },
                  { id: 'a3', label: 'A3' },
                  { id: 'a2', label: 'A2' },
                ] as { id: PaperSize; label: string }[]
              }
              onCommit={setPaper}
            />
            <SelectField
              label={t('print.orientation')}
              value={orientation}
              options={
                [
                  { id: 'landscape', label: t('print.landscape') },
                  { id: 'portrait', label: t('print.portrait') },
                ] as { id: 'landscape' | 'portrait'; label: string }[]
              }
              onCommit={setOrientation}
            />
            <SelectField
              label={t('print.scale')}
              value={scale}
              options={[
                { id: 'fit', label: t('print.fit') },
                ...['50', '75', '100', '150', '200'].map((id) => ({ id, label: `1:${id}` })),
              ]}
              onCommit={setScale}
            />
          </div>
          <ToggleField label={t('print.plans')} value={includePlans} onCommit={setPlans} />
          <ToggleField label={t('print.schedule')} value={includeSchedule} onCommit={setSchedule} />
          <ToggleField label={t('menu.vastu')} value={includeVastu} onCommit={setVastu} />
          <ToggleField label={t('menu.estimate')} value={includeEstimate} onCommit={setEstimate} />
          <div className="row-actions">
            <button
              className="btn primary"
              data-testid="make-pdf"
              disabled={busy || !(includePlans || includeSchedule || includeVastu || includeEstimate)}
              onClick={() => void make()}
            >
              {busy ? t('print.working') : t('print.makePdf')}
            </button>
            <button className="btn" data-testid="print-now" disabled={busy} onClick={nativePrint}>
              {t('print.print')}
            </button>
          </div>
          {status ? (
            <p className="stat" data-testid="print-status">
              {status}
            </p>
          ) : null}
        </section>
        <section className="print-sheets" data-testid="print-preview">
          {project.floors
            .filter((f) => f.visible)
            .map((f) => (
              <figure className="print-sheet" key={f.id}>
                <figcaption>
                  {project.name}: {translateText(lang, f.name)}
                </figcaption>
                <div
                  className="print-svg"
                  dangerouslySetInnerHTML={{ __html: floorSvg(project, f, (s) => translateText(lang, s)) }}
                />
              </figure>
            ))}
        </section>
      </div>
    </ScreenFrame>
  );
}
