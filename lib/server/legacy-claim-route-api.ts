import { getD1Database } from './db.ts';
import { createLegacyClaimApi } from './legacy-claim-api.ts';

export const legacyClaimApi = createLegacyClaimApi(getD1Database);
