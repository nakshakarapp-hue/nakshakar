// Creates a release keystore with a random password, once. Run with: node scripts/setup-signing.mjs
// Both files it writes are git-ignored. Back them up: updates to an installed app must use the same key.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const store = 'android/gharnirman-release.jks';
const props = 'android/keystore.properties';
if (existsSync(store) || existsSync(props)) {
  console.log('Signing key already exists; leaving it untouched.');
  process.exit(0);
}
const password = randomBytes(24).toString('base64url');
const keytool = process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/keytool` : 'keytool';
execFileSync(
  keytool,
  [
    '-genkeypair', '-v',
    '-keystore', store,
    '-storetype', 'PKCS12',
    '-alias', 'gharnirman',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-storepass', password,
    '-keypass', password,
    '-dname', 'CN=Nakshakar, O=Nakshakar, C=IN',
  ],
  { stdio: 'ignore' },
);
writeFileSync(props, `storeFile=gharnirman-release.jks\nstorePassword=${password}\nkeyAlias=gharnirman\nkeyPassword=${password}\n`);
console.log(`Created ${store} and ${props}. Back both up somewhere safe.`);
