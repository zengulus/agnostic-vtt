import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
export const UPLOAD_LIMIT = 10 * 1024 * 1024;
export interface AssetStorage {
  put(roomId: string, id: string, data: Buffer, signal?: AbortSignal): Promise<void>;
  get(roomId: string, id: string): Promise<Buffer>;
  remove(roomId: string, id: string): Promise<void>;
}
export class FileAssetStorage implements AssetStorage {
  constructor(private dir: string) {}
  private path(room: string, id: string) {
    return join(this.dir, 'assets', room, `${id}.webp`);
  }
  async put(room: string, id: string, data: Buffer, signal?: AbortSignal) {
    await mkdir(join(this.dir, 'assets', room), { recursive: true });
    await writeFile(this.path(room, id), data, { mode: 0o600, signal });
  }
  async get(room: string, id: string) {
    return readFile(this.path(room, id));
  }
  async remove(room: string, id: string) {
    try {
      await unlink(this.path(room, id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
export class SupabaseAssetStorage implements AssetStorage {
  constructor(private client: SupabaseClient) {}
  async put(room: string, id: string, data: Buffer) {
    const { error } = await this.client.storage
      .from('tabletop-assets')
      .upload(`${room}/${id}.webp`, data, { contentType: 'image/webp', upsert: false });
    if (error) throw new Error('Image storage is unavailable.');
  }
  async get(room: string, id: string) {
    const { data, error } = await this.client.storage
      .from('tabletop-assets')
      .download(`${room}/${id}.webp`);
    if (error || !data) throw new Error('Stored image unavailable.');
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(room: string, id: string) {
    const { error } = await this.client.storage
      .from('tabletop-assets')
      .remove([`${room}/${id}.webp`]);
    if (error) throw new Error('Image deletion failed.');
  }
}
/** Reject vectors before decoding; strip metadata and emit a single-frame, bounded WebP. */
export async function normalizeImage(data: Buffer, maxSide = 4096) {
  if (data.length > UPLOAD_LIMIT) throw new Error('Upload images up to 10 MiB.');
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255,
    webp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp)
    throw new Error(
      'Upload a real PNG, JPEG or WebP image. SVG and other file types are not accepted.',
    );
  try {
    const image = sharp(data, { limitInputPixels: 20000000, failOn: 'warning', animated: false });
    const metadata = await image.metadata();
    if ((metadata.pages || 1) > 1) throw new Error('Animated images are not supported.');
    const result = await image
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, effort: 3 })
      .timeout({ seconds: 8 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > 8 * 1024 * 1024) throw new Error('Compressed image is too large.');
    return { data: result.data, width: result.info.width, height: result.info.height };
  } catch (error) {
    if (error instanceof Error && error.message === 'Animated images are not supported.')
      throw error;
    throw new Error(
      'This image could not be decoded within the 20-megapixel limit. Try a smaller, complete image.',
    );
  }
}
