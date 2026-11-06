# Putting Nakshakar on Google Play

> **Not in use at the moment.** The app is distributed from the website only. This folder is kept in case
> Google Play is wanted later; the build already produces the Play bundle.

Everything the app needs is ready in this folder and in `release/` after a build. What only you can do is
marked **You**.

## 1. Build the upload file

```
export JAVA_HOME="C:/jdk/jdk-21.0.13+9"
bash scripts/android-apk.sh
```

This writes two files:

| File | For |
|---|---|
| `release/Nakshakar-play.aab` | Upload to Google Play. Updated by Play only. |
| `release/Nakshakar-release.apk` | The website download. Updates itself from the website. |

Both are signed with the key in `android/gharnirman-release.jks` (kept only on this laptop, never committed).
In Play Console this key is your **upload key**; Google keeps the final app signing key. Back the `.jks`
file and `android/keystore.properties` up somewhere safe: without them you cannot upload updates.

## 2. Play Console (You)

1. Create a developer account at play.google.com/console (one-time fee of US$25, identity check).
2. **Create app**: name `Nakshakar`, default language English (India), App, Free.
3. **Set up your app** checklist, using the answers below:
   - Privacy policy URL: the website address followed by `privacy.html`
   - App access: all functions available without special access
   - Ads: no ads
   - Content rating: fill the questionnaire; every answer is "No" (no violence, no user content shared in-app, no purchases). Expected rating: Everyone / 3+
   - Target audience: 18 and over (house planning for adults)
   - News app: no
   - Data safety: see `data-safety.md`
   - Government app: no; Financial features: none; Health: none
4. **Store listing**: copy from `listing.md`, and upload from `images/`:
   - App icon: `images/icon-512.png`
   - Feature graphic: `images/feature-1024x500.png`
   - Phone screenshots: `images/phone-*.png` (at least 2, up to 8)
5. **Testing → Internal testing** (recommended first): create a release, upload `Nakshakar-play.aab`, add
   yourself as a tester, install from the link and try it.
6. New personal developer accounts must run a **closed test with at least 12 testers for 14 days** before
   Production is unlocked. Invite friends' Gmail addresses to a closed test track.
7. **Production → Create release**: upload the same `.aab`, paste the release notes from `listing.md`, roll
   out.

## 3. Updates later

1. Raise `versionCode` (by 1) and `versionName` in `android/app/build.gradle`, and `version` in
   `package.json`.
2. Build, upload the new `.aab` to Play, and publish the website release as usual. The app's update notice
   reads the website's `version.json`: Play users are sent to the Play Store, website users get the APK.

## Checked for this release

- Targets Android 16 (API 36), as Google Play requires for new apps from 31 August 2026.
- Minimum Android 7.0 (API 24).
- No native code, so the 16 KB page size rule does not apply.
- The Play copy does not ask for permission to install apps; only the website copy does.
