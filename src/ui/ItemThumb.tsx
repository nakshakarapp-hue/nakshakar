import { useEffect, useState } from 'react';
import type { ThumbKind } from '../viewer3d/thumbnails';

/** A real rendered picture of a catalogue item, so people choose by how it looks. */
export function ItemThumb({ kind, id }: { kind: ThumbKind; id: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    void import('../viewer3d/thumbnails').then((m) =>
      m.itemThumbnail(kind, id).then((url) => {
        if (live) setSrc(url);
      }),
    );
    return () => {
      live = false;
    };
  }, [kind, id]);
  return src ? (
    <img className="item-thumb" src={src} alt="" />
  ) : (
    <span className="item-thumb empty" aria-hidden="true" />
  );
}
