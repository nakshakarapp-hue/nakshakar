import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import '@fontsource/noto-sans-telugu/telugu-400.css';
import '@fontsource/noto-sans-telugu/telugu-600.css';
import { Capacitor } from '@capacitor/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/theme.css';

// Only the hosted website needs this; the installed apps already carry all their files.
if (location.protocol === 'https:' && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
