// Builds the public website into _site: the landing page, the app at /app/, and every recent installer
// at /downloads/, so nothing a visitor clicks ever leaves the site.
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = process.env.GITHUB_REPOSITORY ?? 'nakshakarapp-hue/nakshakar';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
// Hosted sites are limited to 1 GB, and one version is about 155 MB.
const KEEP_VERSIONS = 5;
const OUT = '_site';

if (!existsSync('dist/index.html')) throw new Error('Run the app build first: dist is missing.');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/downloads`, { recursive: true });
cpSync('site', OUT, { recursive: true });
cpSync('dist', `${OUT}/app`, { recursive: true });

const headers = {
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};
const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers });
if (!response.ok) throw new Error(`Could not list releases: ${response.status}`);
const releases = (await response.json()).filter((r) => !r.draft && !r.prerelease).slice(0, KEEP_VERSIONS);

const PLATFORM = { '.exe': 'windows', '.apk': 'android' };
const versions = [];
for (const release of releases) {
  const folder = `downloads/${release.tag_name}`;
  mkdirSync(`${OUT}/${folder}`, { recursive: true });
  const files = {};
  for (const asset of release.assets) {
    const platform = PLATFORM[asset.name.slice(asset.name.lastIndexOf('.'))];
    if (!platform) continue;
    const file = await fetch(asset.browser_download_url, { redirect: 'follow' });
    if (!file.ok) throw new Error(`Could not download ${asset.name}: ${file.status}`);
    const path = `${folder}/${asset.name}`;
    await pipeline(Readable.fromWeb(file.body), createWriteStream(`${OUT}/${path}`));
    const size = statSync(`${OUT}/${path}`).size;
    if (size !== asset.size) throw new Error(`${asset.name} is ${size} bytes, expected ${asset.size}`);
    files[platform] = { path, name: asset.name, size };
  }
  versions.push({ version: release.tag_name.replace(/^v/, ''), date: release.published_at, files });
  console.log(`${release.tag_name}: ${Object.keys(files).join(', ')}`);
}
writeFileSync(`${OUT}/downloads/versions.json`, JSON.stringify(versions, null, 2));

// The newest version, for the apps' update notice: number, date, what changed and where to get it.
const [owner, name] = REPO.split('/');
const SITE = process.env.SITE_URL ?? `https://${owner.toLowerCase()}.github.io/${name}/`;
const latest = releases[0];
if (latest) {
  const files = versions[0].files;
  const notes = (latest.body ?? '')
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*] /.test(line))
    .map((line) => line.replace(/^\s*[-*] /, '').trim())
    .slice(0, 12);
  const link = (f) => (f ? { url: `${SITE}${f.path}`, size: f.size } : undefined);
  writeFileSync(
    `${OUT}/version.json`,
    JSON.stringify(
      {
        version: latest.tag_name.replace(/^v/, ''),
        date: latest.published_at,
        notes,
        android: link(files.android),
        windows: link(files.windows),
      },
      null,
      2,
    ),
  );
  console.log(`version.json: ${latest.tag_name}, ${notes.length} notes`);
}
