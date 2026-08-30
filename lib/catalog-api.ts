import { readCatalog, type CatalogQuery } from './catalog-repository.ts';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
const MAX_QUERY_LENGTH = 100;

function positiveInteger(value: string | null, fallback: number, maximum?: number) {
  if (value === null || value === '') return { value: fallback };
  if (!/^\d+$/.test(value)) return { error: true };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) return { error: true };
  return { value: parsed };
}

function parseQuery(request: Request): CatalogQuery | null {
  const params = new URL(request.url).searchParams;
  const page = positiveInteger(params.get('page'), DEFAULT_PAGE);
  const pageSize = positiveInteger(params.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const q = (params.get('q') ?? '').trim();
  if ('error' in page || 'error' in pageSize || q.length > MAX_QUERY_LENGTH) return null;
  return { q, category: params.get('category'), page: page.value, pageSize: pageSize.value };
}

export function createCatalogGetHandler(getDb: () => D1Database) {
  return async function GET(request: Request) {
    const query = parseQuery(request);
    if (!query) return Response.json({ error: 'พารามิเตอร์แคตตาล็อกไม่ถูกต้อง' }, { status: 400 });
    try {
      return Response.json(await readCatalog(getDb(), query));
    } catch (error) {
      console.error('Unable to read catalog', error);
      return Response.json({ error: 'ไม่สามารถโหลดแคตตาล็อกได้' }, { status: 500 });
    }
  };
}
