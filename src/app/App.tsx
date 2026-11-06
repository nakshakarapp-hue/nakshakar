import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { lazy, Suspense, useEffect, useState } from 'react';
import { restoreFromBackups } from '../core/storage/backup';
import { Home } from '../ui/Home';
import { EditorScreen } from '../ui/EditorScreen';
import { SharedDialog } from '../ui/SharedDialog';
import { UpdatePopup } from '../ui/UpdatePopup';
import { translate, useT } from './i18n';
import { useApp, type Prefs } from './store';

// 3D and PDF are heavy, so they load only when first opened. Everything is in the app bundle: this works offline.
const View3D = lazy(() => import('../viewer3d/View3D').then((m) => ({ default: m.View3D })));
const VastuScreen = lazy(() => import('../ui/reports').then((m) => ({ default: m.VastuScreen })));
const EstimateScreen = lazy(() => import('../ui/reports').then((m) => ({ default: m.EstimateScreen })));
const PrintScreen = lazy(() => import('../ui/reports').then((m) => ({ default: m.PrintScreen })));

const PREFS_KEY = 'gharnirman.prefs';

export function App() {
  const t = useT();
  const screen = useApp((s) => s.screen);
  const theme = useApp((s) => s.prefs.theme);
  const language = useApp((s) => s.prefs.language);
  const prefs = useApp((s) => s.prefs);
  const toast = useApp((s) => s.toast);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await Preferences.get({ key: PREFS_KEY }).catch(() => ({ value: null }));
      if (stored.value) {
        useApp.setState((s) => ({
          prefs: { ...s.prefs, ...(JSON.parse(stored.value as string) as Partial<Prefs>) },
        }));
      }
      await restoreFromBackups().catch(() => 0);
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) void Preferences.set({ key: PREFS_KEY, value: JSON.stringify(prefs) }).catch(() => undefined);
  }, [prefs, ready]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
  }, [theme, language]);

  // A shared file opened from outside the app: double-clicked on Windows, tapped on a phone.
  useEffect(() => {
    if (!ready) return;
    const open = window as unknown as { __openShared?: (text: string) => void };
    open.__openShared = (text) => useApp.getState().openSharedText(text);
    // The Windows app waits for this before passing on a file it was started with.
    window.dispatchEvent(new Event('nakshakar-ready'));
    if (!Capacitor.isNativePlatform()) return;
    const openUrl = async (url?: string) => {
      if (!url || url.startsWith('http')) return;
      try {
        const file = await Filesystem.readFile({ path: url, encoding: Encoding.UTF8 });
        useApp.getState().openSharedText(String(file.data));
      } catch {
        useApp.getState().openSharedText('');
      }
    };
    void CapApp.getLaunchUrl().then((launch) => openUrl(launch?.url));
    const handle = CapApp.addListener('appUrlOpen', ({ url }) => void openUrl(url));
    return () => void handle.then((h) => h.remove());
  }, [ready]);

  // Anything still unsaved is written the moment the app leaves the foreground.
  useEffect(() => {
    const flush = () => void useApp.getState().flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];
    if (Capacitor.isNativePlatform()) {
      handles.push(CapApp.addListener('pause', flush));
      handles.push(
        CapApp.addListener('backButton', () => {
          const s = useApp.getState();
          if (s.dialog) s.setDialog(null);
          else if (s.screen !== 'editor' && s.screen !== 'home') s.go('editor');
          else if (s.screen === 'editor') void s.closeProject();
          else void CapApp.exitApp();
        }),
      );
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      handles.forEach((h) => void h.then((x) => x.remove()));
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (e.detail > 0 && el?.tagName === 'BUTTON') el.blur();
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  if (!ready) return <div className="splash">{translate(language, 'common.loading')}</div>;

  return (
    <>
      {screen === 'home' ? <Home /> : null}
      {screen === 'editor' ? <EditorScreen /> : null}
      <Suspense fallback={<div className="splash">{t('common.loading')}</div>}>
        {screen === 'view3d' ? <View3D /> : null}
        {screen === 'explore' ? <View3D explore /> : null}
        {screen === 'vastu' ? <VastuScreen /> : null}
        {screen === 'estimate' ? <EstimateScreen /> : null}
        {screen === 'print' ? <PrintScreen /> : null}
      </Suspense>
      <SharedDialog />
      <UpdatePopup />
      {toast ? (
        <div className="toast" role="status" data-testid="toast">
          {toast}
        </div>
      ) : null}
    </>
  );
}
