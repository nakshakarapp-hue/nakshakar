import { Building2, Eye, FolderPlus } from 'lucide-react';
import { useT } from '../app/i18n';
import { useApp } from '../app/store';
import { sharedSummary } from '../core/storage/shared';
import { Dialog } from './fields';

/** What someone sees on opening a house a friend sent: what it is, and whether to view or keep it. */
export function SharedDialog() {
  const t = useT();
  const pending = useApp((s) => s.pendingShared);
  if (!pending) return null;
  const store = useApp.getState();
  const { project, sharedAt } = pending;
  const summary = sharedSummary(project);
  return (
    <Dialog
      title={t('shared.title')}
      onClose={() => store.setPendingShared(null)}
      footer={
        <>
          <button className="btn" data-testid="shared-view" onClick={() => store.viewShared()}>
            <Eye size={16} aria-hidden="true" /> {t('shared.view')}
          </button>
          <button className="btn primary" data-testid="shared-save" onClick={() => void store.saveShared()}>
            <FolderPlus size={16} aria-hidden="true" /> {t('shared.save')}
          </button>
        </>
      }
    >
      <div className="shared-card" data-testid="shared-card">
        {project.thumbnail ? (
          <img src={project.thumbnail} alt="" />
        ) : (
          <span className="thumb-empty">
            <Building2 size={28} strokeWidth={1.25} aria-hidden="true" />
          </span>
        )}
        <strong data-testid="shared-name">{project.name}</strong>
        <span className="muted small">
          {t('shared.summary')
            .replace('{floors}', String(summary.floors))
            .replace('{rooms}', String(summary.rooms))
            .replace('{area}', summary.area.toFixed(0))}
        </span>
        {sharedAt ? (
          <span className="muted small">
            {t('shared.when').replace('{date}', new Date(sharedAt).toLocaleDateString())}
          </span>
        ) : null}
      </div>
      <p className="muted small">{t('shared.help')}</p>
    </Dialog>
  );
}
