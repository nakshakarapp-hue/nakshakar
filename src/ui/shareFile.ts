import { produce } from 'immer';
import type { Project } from '../core/model/types';
import { packShared, shareFileName } from '../core/storage/shared';
import { renderThumbnail } from '../editor2d/thumbnail';

/** Makes the file a friend can open: download in a browser, the share sheet on a phone. */
export async function shareHouse(project: Project): Promise<void> {
  const withPicture = produce(project, (d) => {
    d.thumbnail = renderThumbnail(project);
  });
  const blob = new Blob([packShared(withPicture)], { type: 'application/octet-stream' });
  const { shareOrDownload } = await import('../print/share');
  await shareOrDownload(blob, shareFileName(project.name));
}
