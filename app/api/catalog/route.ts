import { env } from 'cloudflare:workers';
import { createCatalogGetHandler } from '@/lib/catalog-api';

function getDb() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}

export const GET = createCatalogGetHandler(getDb);
