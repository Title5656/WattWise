import app from 'vinext/server/app-router-entry';
import { createAccessGuard, verifyAccessJwt } from './lib/server/cloudflare-access.ts';

export default createAccessGuard(app, verifyAccessJwt, import.meta.env.DEV);
