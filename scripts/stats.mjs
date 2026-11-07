// Prints how many times each installer has been downloaded, per version and in total.
// Reads the public releases of nakshakarapp-hue/nakshakar; no sign-in needed.
const REPO = process.env.REPO ?? 'nakshakarapp-hue/nakshakar';
const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
  headers: { Accept: 'application/vnd.github+json' },
});
if (!response.ok) throw new Error(`Could not read releases: ${response.status}`);
const releases = await response.json();
const totals = { windows: 0, android: 0 };
const rows = releases.map((r) => {
  const count = (ext) => r.assets.filter((a) => a.name.endsWith(ext)).reduce((n, a) => n + a.download_count, 0);
  const row = { version: r.tag_name, published: r.published_at.slice(0, 10), windows: count('.exe'), android: count('.apk') };
  totals.windows += row.windows;
  totals.android += row.android;
  return row;
});
console.table(rows);
console.log(`Total downloads: ${totals.windows + totals.android} (Windows ${totals.windows}, Android ${totals.android})`);
console.log('Website visits and button clicks: https://nakshakar.goatcounter.com');
