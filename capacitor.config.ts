import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.nakshakar.app',
  appName: 'Nakshakar',
  webDir: 'dist',
  android: { allowMixedContent: false },
  // Android 16 draws apps under the status and navigation bars; the page's safe-area spacing handles it.
  plugins: { SystemBars: { insetsHandling: 'native' } },
};

export default config;
