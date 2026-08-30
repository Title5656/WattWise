import { env } from 'cloudflare:workers';
import { createHomeHandlers } from '@/lib/home-api';

function getDb() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}

export const { GET, PUT, POST } = createHomeHandlers(getDb);
