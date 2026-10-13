import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { assetUrl } from '../shared/assets.js';
import type { Asset } from '../shared/model.js';
import { authorizedFetch } from './connection.js';
import { useTable } from './store.js';
const blobs = new Map<string, Promise<string>>();
useTable.subscribe((state, previous) => {
  if (
    state.room.id !== previous.room.id ||
    state.self?.id !== previous.self?.id ||
    state.self?.role !== previous.self?.role
  ) {
    for (const blob of blobs.values()) void blob.then(URL.revokeObjectURL).catch(() => {});
    blobs.clear();
  }
});
export function resolveAsset(asset: Asset, roomId: string): Promise<string> {
  if (asset.kind !== 'uploaded') return Promise.resolve(assetUrl(asset, import.meta.env.BASE_URL));
  const key = `${roomId}/${asset.url}`;
  let pending = blobs.get(key);
  if (!pending) {
    pending = authorizedFetch(`/api/assets/${key}`)
      .then((r) => r.blob())
      .then((b) => URL.createObjectURL(b))
      .catch((e) => {
        blobs.delete(key);
        throw e;
      });
    blobs.set(key, pending);
    if (blobs.size > 80) {
      const first = blobs.keys().next().value!;
      void blobs
        .get(first)
        ?.then(URL.revokeObjectURL)
        .catch(() => {});
      blobs.delete(first);
    }
  }
  return pending;
}
export function AssetImage({
  asset,
  ...props
}: { asset: Asset } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const roomId = useTable((s) => s.room.id),
    identity = useTable((s) => `${s.self?.id}/${s.self?.role}`),
    [src, setSrc] = useState<string>(),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc(undefined);
    setFailed(false);
    void resolveAsset(asset, roomId)
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) {
          setSrc(undefined);
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [roomId, identity, asset.kind, asset.url]);
  return (
    <img
      {...props}
      loading={props.loading || 'lazy'}
      src={src}
      referrerPolicy="no-referrer"
      data-asset-failed={failed || undefined}
    />
  );
}
