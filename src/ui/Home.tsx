import { Footprints, House, MoreHorizontal, Settings, Building, FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LANGUAGES, translateText, useT } from '../app/i18n';
import { openStoredProject, startNewProject, useApp } from '../app/store';
import { createSampleProject } from '../catalog/templates';
import { APP_NAME } from '../core/model/defaults';
import { newId } from '../core/model/ids';
import type { ProjectMeta, ThemeName } from '../core/model/types';
import { removeBackup, writeBackup } from '../core/storage/backup';
import { deleteProject, listProjects, loadProject, saveProject } from '../core/storage/db';
import { LENGTH_UNITS } from '../core/units';
import { UnitConverter } from './dialogs';
import { Dialog, SelectField } from './fields';
import { shareHouse } from './shareFile';

export function Home() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<ProjectMeta | null>(null);
  const [rename, setRename] = useState<ProjectMeta | null>(null);
  const [showConverter, setShowConverter] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useApp((s) => s.pendingShared);
  useEffect(() => {
    // Saving a friend's house from here lands in the editor, but keep the list right either way.
    void refresh();
  }, [pending]);

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));

  useEffect(() => {
    void refresh();
  }, []);

  const importFile = async (file: File) => {
    useApp.getState().openSharedText(await file.text());
  };

  const openSample = () => {
    const p = createSampleProject();
    p.name = translateText(prefs.language, p.name);
    void saveProject(p).then(() => useApp.getState().openProject(p));
  };

  return (
    <div
      className="home-page"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) void importFile(f);
      }}
    >
      <header className="home-bar">
        <img src="./icon.svg" alt="" width={28} height={28} />
        <strong>{APP_NAME}</strong>
        <span className="topbar-spacer" />
        <button className="btn ghost" data-testid="home-converter" onClick={() => setShowConverter(true)}>
          {t('menu.converter')}
        </button>
        <button
          className="btn ghost"
          data-testid="home-settings"
          aria-label={t('menu.settings')}
          title={t('menu.settings')}
          onClick={() => setShowSettings(true)}
        >
          <Settings size={19} aria-hidden="true" />
        </button>
      </header>

      <main className="home">
        <section className="home-hero new-project">
          <div className="hero-copy">
            <p className="hero-kicker">{t('home.kicker')}</p>
            <h1>{t('home.heroTitle')}</h1>
            <p className="hero-sub">{t('home.tagline')}</p>
          </div>
          <div className="home-create">
            <input
              className="input"
              data-testid="new-name"
              aria-label={t('home.new')}
              placeholder={t('home.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void startNewProject(name.trim() || t('home.untitled'));
              }}
            />
            <button
              className="btn primary"
              data-testid="create-project"
              onClick={() => void startNewProject(name.trim() || t('home.untitled'))}
            >
              {t('home.create')}
            </button>
          </div>
          <div className="hero-tiles">
            <button className="hero-tile" data-testid="open-sample" onClick={openSample}>
              <Building size={22} aria-hidden="true" />
              <strong>{t('home.sample')}</strong>
              <span>{t('home.sampleHint')}</span>
            </button>
            <button className="hero-tile" data-testid="open-shared" onClick={() => fileRef.current?.click()}>
              <FolderOpen size={22} aria-hidden="true" />
              <strong>{t('shared.open')}</strong>
              <span>{t('home.sharedHint')}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              data-testid="shared-file"
              accept=".nakshakar,.gharnirman,.json,application/json,application/octet-stream"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        <section>
          <h2 className="home-section-title">{t('home.projects')}</h2>
          {projects === null ? <p className="muted">{t('common.loading')}</p> : null}
          {projects?.length === 0 ? (
            <p className="muted empty-note" data-testid="no-projects">
              {t('home.none')}
            </p>
          ) : null}
          <ul className="project-grid" data-testid="project-list">
            {projects?.map((m) => (
              <li key={m.id} className="project-card">
                <button
                  className="project-open"
                  data-testid="open-project"
                  onClick={() => void openStoredProject(m.id)}
                >
                  {m.thumbnail ? (
                    <img src={m.thumbnail} alt="" />
                  ) : (
                    <span className="thumb-empty">
                      <House size={28} strokeWidth={1.25} aria-hidden="true" />
                    </span>
                  )}
                  <strong>{m.name}</strong>
                  <span className="muted">
                    {new Date(m.updatedAt).toLocaleDateString()} ·{' '}
                    {t('home.floors').replace('{n}', String(m.floorCount))}
                  </span>
                </button>
                <div className="project-actions">
                  <button
                    className="btn"
                    data-testid="home-explore"
                    onClick={() => void openStoredProject(m.id).then(() => useApp.getState().go('explore'))}
                  >
                    <Footprints size={15} aria-hidden="true" /> {t('nav.explore')}
                  </button>
                  <span className="topbar-spacer" />
                  <button
                    className="btn ghost"
                    data-testid="project-more"
                    aria-label={t('common.more')}
                    aria-expanded={menuFor === m.id}
                    title={t('common.more')}
                    onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                  >
                    <MoreHorizontal size={19} aria-hidden="true" />
                  </button>
                  {menuFor === m.id ? (
                    <div className="pop-menu" role="menu" onClick={() => setMenuFor(null)}>
                      <button role="menuitem" onClick={() => setRename(m)}>
                        {t('common.rename')}
                      </button>
                      <button
                        role="menuitem"
                        onClick={() =>
                          void loadProject(m.id).then(async (p) => {
                            if (!p) return;
                            const copy = {
                              ...p,
                              id: newId(),
                              name: `${p.name} ${t('home.copySuffix')}`,
                              updatedAt: Date.now(),
                              createdAt: Date.now(),
                            };
                            await saveProject(copy);
                            await refresh();
                          })
                        }
                      >
                        {t('common.duplicate')}
                      </button>
                      <button
                        role="menuitem"
                        onClick={() =>
                          void loadProject(m.id).then((p) => {
                            if (p) void shareHouse(p);
                          })
                        }
                      >
                        {t('shared.shareFile')}
                      </button>
                      <button
                        role="menuitem"
                        className="danger-item"
                        data-testid="delete-project"
                        onClick={() => setConfirm(m)}
                      >
                        {t('action.delete')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <p className="muted small home-note">{t('home.privacy')}</p>
      </main>

      {showSettings ? (
        <Dialog title={t('menu.settings')} onClose={() => setShowSettings(false)}>
          <SelectField
            label={t('settings.language')}
            testId="language"
            value={prefs.language}
            options={LANGUAGES}
            onCommit={(language) => setPrefs({ language })}
          />
          <SelectField
            label={t('settings.theme')}
            value={prefs.theme}
            testId="theme"
            options={(['light', 'dark', 'outdoor'] as ThemeName[]).map((id) => ({
              id,
              label: t(`theme.${id}`),
            }))}
            onCommit={(theme) => setPrefs({ theme })}
          />
          <SelectField
            label={t('settings.displayUnit')}
            value={prefs.displayUnit}
            options={LENGTH_UNITS.map((id) => ({ id, label: t(`unit.${id}`) }))}
            onCommit={(displayUnit) => setPrefs({ displayUnit })}
          />
        </Dialog>
      ) : null}

      {confirm ? (
        <Dialog
          title={t('home.deleteTitle')}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger"
                data-testid="confirm-delete"
                onClick={() =>
                  void Promise.all([deleteProject(confirm.id), removeBackup(confirm.id)]).then(() => {
                    setConfirm(null);
                    void refresh();
                  })
                }
              >
                {t('action.delete')}
              </button>
            </>
          }
        >
          <p>{t('home.deleteBody').replace('{name}', confirm.name)}</p>
        </Dialog>
      ) : null}

      {rename ? (
        <RenameDialog
          meta={rename}
          onDone={() => {
            setRename(null);
            void refresh();
          }}
        />
      ) : null}
      {showConverter ? (
        <Dialog title={t('menu.converter')} onClose={() => setShowConverter(false)}>
          <UnitConverter />
        </Dialog>
      ) : null}
    </div>
  );
}

function RenameDialog({ meta, onDone }: { meta: ProjectMeta; onDone: () => void }) {
  const t = useT();
  const [value, setValue] = useState(meta.name);
  return (
    <Dialog
      title={t('common.rename')}
      onClose={onDone}
      footer={
        <button
          className="btn primary"
          onClick={() =>
            void loadProject(meta.id).then(async (p) => {
              if (p) {
                const next = { ...p, name: value.trim() || p.name, updatedAt: Date.now() };
                await saveProject(next);
                await writeBackup(next);
              }
              onDone();
            })
          }
        >
          {t('common.save')}
        </button>
      }
    >
      <input className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
}
