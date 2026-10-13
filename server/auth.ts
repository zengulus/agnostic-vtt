import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
export interface Identity {
  id: string;
  name: string;
  expiresAt?: number;
}
export interface Auth {
  verify(token: string): Promise<Identity>;
}
export class LocalAuth implements Auth {
  constructor(private secret: string) {}
  issue(name: string) {
    const identity = { id: randomUUID(), name };
    const data = Buffer.from(JSON.stringify({ ...identity, exp: Date.now() + 86400000 })).toString(
      'base64url',
    );
    return { ...identity, token: `${data}.${this.sign(data)}` };
  }
  private sign(data: string) {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }
  async verify(token: string): Promise<Identity> {
    const [data, signature] = token.split('.');
    if (!data || !signature)
      throw new Error('Your local session expired. Reload to sign in again.');
    const actual = Buffer.from(signature),
      expected = Buffer.from(this.sign(data));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error('Invalid session.');
    const user = JSON.parse(Buffer.from(data, 'base64url').toString()) as Identity & {
      exp: number;
    };
    if (!user.id || !user.name || user.exp < Date.now())
      throw new Error('Your session expired. Sign in again.');
    return { id: user.id, name: user.name, expiresAt: user.exp };
  }
}
export class SupabaseAuth implements Auth {
  private cache = new Map<string, { identity: Identity; until: number }>();
  constructor(private client: SupabaseClient) {}
  async verify(token: string): Promise<Identity> {
    const cached = this.cache.get(token);
    if (cached && cached.until > Date.now()) return cached.identity;
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) throw new Error('Sign in to join this campaign.');
    const exp =
      Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp) * 1000;
    if (!Number.isFinite(exp) || exp <= Date.now()) throw new Error('Session expired.');
    const identity = {
      id: data.user.id,
      name: String(
        data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'Adventurer',
      ).slice(0, 32),
      expiresAt: exp,
    };
    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(token, { identity, until: Math.min(exp, Date.now() + 30000) });
    return identity;
  }
}
