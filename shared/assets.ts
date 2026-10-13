import type { Asset } from './model.js';
export const builtinAssets = new Set([
  'hollow.svg',
  'sanctuary.svg',
  'ranger.svg',
  'mage.svg',
  'sentinel.svg',
  'wisp.svg',
]);
/** No server requests remote URLs. Reject obvious private hosts to reduce client privacy mistakes. */
export function validateAsset(asset: Asset): void {
  if (asset.kind === 'uploaded') {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(asset.url) ||
      ['__proto__', 'constructor', 'prototype'].includes(asset.url)
    )
      throw new Error('Invalid uploaded asset reference.');
    return;
  }
  if (asset.kind === 'builtin') {
    if (!builtinAssets.has(asset.url)) throw new Error('Unknown built-in image.');
    return;
  }
  let url: URL;
  try {
    url = new URL(asset.url);
  } catch {
    throw new Error('Paste a complete HTTPS image URL.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Use a public HTTPS image URL without credentials or custom ports.');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    host.includes(':') ||
    /^[\d.]+$/.test(host)
  )
    throw new Error('Use a public image hostname, not a local or numeric address.');
}
export function assetUrl(asset: Asset, base = '/'): string {
  return asset.kind === 'builtin' ? `${base}assets/${asset.url}` : asset.url;
}
