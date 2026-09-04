import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type AccessConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
};

export type VerifiedAccessIdentity = {
  subject: string;
  email: string;
  displayName: string;
};

type WorkerHandler = {
  fetch(request: Request, env?: Cloudflare.Env, ctx?: ExecutionContext): Promise<Response>;
};

type VerifyAccessToken = (token: string, config: AccessConfig) => Promise<VerifiedAccessIdentity>;

const remoteKeys = new Map<string, JWTVerifyGetKey>();

export function readAccessConfig(env: Pick<Cloudflare.Env, 'CLOUDFLARE_ACCESS_TEAM_DOMAIN' | 'CLOUDFLARE_ACCESS_AUD'>): AccessConfig {
  const teamDomain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!teamDomain || !audience) throw new Error('Cloudflare Access configuration is unavailable.');
  const issuer = `https://${teamDomain}`;
  return { issuer, audience, jwksUrl: `${issuer}/cdn-cgi/access/certs` };
}

function remoteJwks(config: AccessConfig): JWTVerifyGetKey {
  let getKey = remoteKeys.get(config.jwksUrl);
  if (!getKey) {
    getKey = createRemoteJWKSet(new URL(config.jwksUrl));
    remoteKeys.set(config.jwksUrl, getKey);
  }
  return getKey;
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  getKey: JWTVerifyGetKey = remoteJwks(config),
): Promise<VerifiedAccessIdentity> {
  const { payload } = await jwtVerify(token, getKey, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'email'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Cloudflare Access identity is incomplete.');
  }
  const email = payload.email.trim().toLowerCase();
  if (!email) throw new Error('Cloudflare Access identity is incomplete.');
  return {
    subject: payload.sub,
    email,
    displayName: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : email,
  };
}

export function withVerifiedIdentity(request: Request, identity: VerifiedAccessIdentity): Request {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    const normalized = name.toLowerCase();
    if (normalized.startsWith('oai-authenticated-user-')
      || normalized.startsWith('cf-access-')
      || normalized.startsWith('x-wattwise-auth-')) {
      headers.delete(name);
    }
  }
  headers.set('x-wattwise-auth-subject', identity.subject);
  headers.set('x-wattwise-auth-email', identity.email);
  headers.set('x-wattwise-auth-name', identity.displayName);
  return new Request(request, { headers });
}

function localSitesIdentity(request: Request): VerifiedAccessIdentity | null {
  const subject = request.headers.get('oai-authenticated-user-id')?.trim();
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  if (!subject || !email) return null;
  return {
    subject,
    email,
    displayName: request.headers.get('oai-authenticated-user-full-name')?.trim() || email,
  };
}

function authenticationRequired(): Response {
  return Response.json({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' }, { status: 401 });
}

export function createAccessGuard(
  handler: WorkerHandler,
  verify: VerifyAccessToken = verifyAccessJwt,
  allowLocalSitesIdentity = false,
) {
  return {
    async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/catalog') return handler.fetch(request, env, ctx);

      const localIdentity = allowLocalSitesIdentity ? localSitesIdentity(request) : null;
      if (localIdentity) return handler.fetch(withVerifiedIdentity(request, localIdentity), env, ctx);

      const token = request.headers.get('cf-access-jwt-assertion');
      if (!token) return authenticationRequired();
      try {
        return handler.fetch(withVerifiedIdentity(request, await verify(token, readAccessConfig(env))), env, ctx);
      } catch {
        return authenticationRequired();
      }
    },
  };
}
