import { env } from 'cloudflare:workers';

export function getD1Database(): D1Database {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}
