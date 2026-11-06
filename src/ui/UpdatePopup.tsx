import { Download, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../app/i18n';
import {
  APP_VERSION,
  AppUpdater,
  SITE_URL,
  checkForUpdate,
  currentChannel,
  type Channel,
  type Release,
} from '../app/update';

const LATER_KEY = 'nakshakar.updateLater';

/**
 * Tells people when a newer version is out: its number, date and what changed, with one button to get
 * it. Asking again waits a day after Later.
 */
export function UpdatePopup() {
  const t = useT();
  const [release, setRelease] = useState<Release | null>(null);
  const [channel, setChannel] = useState<Channel>('web');
  const [state, setState] = useState<'idle' | 'working' | 'permission' | 'failed'>('idle');

  useEffect(() => {
    const id = setTimeout(() => {
      void (async () => {
        const later = JSON.parse(localStorage.getItem(LATER_KEY) ?? 'null') as {
          version: string;
          at: number;
        } | null;
        const found = await checkForUpdate();
        if (!found) return;
        if (later && later.version === found.version && Date.now() - later.at < 24 * 3600 * 1000) return;
        setChannel(await currentChannel());
        setRelease(found);
      })();
    }, 2500);
    return () => clearTimeout(id);
  }, []);

  if (!release) return null;

  const later = () => {
    localStorage.setItem(LATER_KEY, JSON.stringify({ version: release.version, at: Date.now() }));
    setRelease(null);
  };

  const update = async () => {
    setState('working');
    try {
      if (channel === 'web') {
        // The new files are fetched afresh, then the page starts again on them.
        const registration = await navigator.serviceWorker?.getRegistration();
        await registration?.update();
        const names = await caches?.keys();
        await Promise.all((names ?? []).map((n) => caches.delete(n)));
        location.reload();
        return;
      }
      if (channel === 'play') {
        await AppUpdater.openStore();
        setState('idle');
        return;
      }
      if (channel === 'direct' && release.android) {
        const r = await AppUpdater.downloadAndInstall({ url: release.android.url });
        setState(r.needsPermission ? 'permission' : 'working');
        return;
      }
      // Windows, and anything else: the download page, in the browser.
      window.open(`${SITE_URL}#downloads`, '_blank');
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  const size =
    channel === 'direct' ? release.android?.size : channel === 'windows' ? release.windows?.size : 0;
  return (
    <div className="update-backdrop" role="presentation">
      <div
        className="update-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        data-testid="update-popup"
      >
        <div className="update-head">
          <Sparkles size={22} aria-hidden="true" />
          <div>
            <h2 id="update-title">{t('update.title')}</h2>
            <p className="muted" data-testid="update-versions">
              {t('update.versions').replace('{new}', release.version).replace('{old}', APP_VERSION)}
              {release.date ? ` · ${new Date(release.date).toLocaleDateString()}` : ''}
              {size ? ` · ${(size / 1024 / 1024).toFixed(1)} MB` : ''}
            </p>
          </div>
        </div>
        {release.notes.length ? (
          <>
            <h3 className="update-what">{t('update.whatsNew')}</h3>
            <ul className="update-notes">
              {release.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        ) : null}
        {state === 'working' && channel === 'direct' ? (
          <p className="update-status">{t('update.downloading')}</p>
        ) : null}
        {state === 'permission' ? <p className="update-status">{t('update.permission')}</p> : null}
        {state === 'failed' ? <p className="update-status error">{t('update.failed')}</p> : null}
        <div className="update-actions">
          <button className="btn" data-testid="update-later" onClick={later}>
            {t('update.later')}
          </button>
          <button
            className="btn primary"
            data-testid="update-now"
            disabled={state === 'working' && channel !== 'web'}
            onClick={() => void update()}
          >
            <Download size={16} aria-hidden="true" />
            {channel === 'play' ? t('update.store') : t('update.now')}
          </button>
        </div>
      </div>
    </div>
  );
}
