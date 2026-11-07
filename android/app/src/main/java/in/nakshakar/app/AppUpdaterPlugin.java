package in.nakshakar.app;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Getting a newer version. The Google Play build sends people to its Play Store page, since apps from
 * Play may only be updated by Play. The build from the website downloads the new APK from the website
 * and hands it to Android's installer, which only accepts it if it is signed with the same key.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /** The only places an update is downloaded from: the releases of the public repository, or the site. */
    private static final String RELEASES = "https://github.com/nakshakarapp-hue/nakshakar/releases/download/";
    private static final String SITE = "https://nakshakarapp-hue.github.io/nakshakar/";
    private static final String FILE_PREFIX = "nakshakar-update";

    @PluginMethod
    public void channel(PluginCall call) {
        JSObject result = new JSObject();
        result.put("channel", BuildConfig.FLAVOR);
        result.put("versionName", BuildConfig.VERSION_NAME);
        result.put("versionCode", BuildConfig.VERSION_CODE);
        call.resolve(result);
    }

    @PluginMethod
    public void openStore(PluginCall call) {
        String id = getContext().getPackageName();
        try {
            start(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + id)));
        } catch (ActivityNotFoundException e) {
            start(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + id)));
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        if (!"direct".equals(BuildConfig.FLAVOR)) {
            call.reject("This copy is updated through Google Play.");
            return;
        }
        String url = call.getString("url");
        if (url == null || !(url.startsWith(RELEASES) || url.startsWith(SITE)) || !url.endsWith(".apk")) {
            call.reject("Updates only come from the Nakshakar website.");
            return;
        }
        Context context = getContext();
        // Android asks once whether this app may install updates; until then, its settings screen opens.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
            start(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName())));
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("needsPermission", true);
            call.resolve(result);
            return;
        }
        File folder = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (folder == null) {
            call.reject("No space to download the update.");
            return;
        }
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        // Earlier attempts are cleared first, and each attempt gets its own file: Android will not start
        // a download into a file that an earlier download still owns, so a second tap would hang.
        SharedPreferences prefs = context.getSharedPreferences("updater", Context.MODE_PRIVATE);
        long previous = prefs.getLong("download", -1);
        if (previous != -1) manager.remove(previous);
        File[] old = folder.listFiles((dir, name) -> name.startsWith(FILE_PREFIX));
        if (old != null) for (File f : old) f.delete();
        File apk = new File(folder, FILE_PREFIX + System.currentTimeMillis() + ".apk");
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
            .setTitle("Nakshakar update")
            .setDescription("Downloading the new version")
            .setMimeType("application/vnd.android.package-archive")
            .setDestinationUri(Uri.fromFile(apk))
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        long id = manager.enqueue(request);
        prefs.edit().putLong("download", id).apply();

        BroadcastReceiver done = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                c.unregisterReceiver(this);
                boolean ok = false;
                try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        ok = status == DownloadManager.STATUS_SUCCESSFUL;
                    }
                }
                if (!ok || !apk.exists()) return;
                Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(install);
            }
        };
        ContextCompat.registerReceiver(
            context,
            done,
            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED
        );
        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    private void start(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }
}
