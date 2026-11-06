import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Hands a generated file to the user. On a device it opens the system share sheet, from which the
 * user can save, send or print it. In a browser it downloads the file.
 */
export async function shareOrDownload(blob: Blob, fileName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({
      path: fileName,
      data: await toBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title: fileName, url: written.uri, dialogTitle: fileName });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
