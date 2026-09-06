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
    requiredClaims: ['sub'],
  });
  const commonName = typeof payload.common_name === 'string' ? payload.common_name.trim() : '';
  if (payload.type === 'app' && payload.sub === '' && /^[a-zA-Z0-9.-]{1,200}$/.test(commonName)) {
    return {
      subject: `service-token:${commonName}`,
      email: `${commonName}@service-token.wattwise.invalid`,
      displayName: 'Cloudflare Access service token',
    };
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || typeof payload.email !== 'string') {
    throw new Error('Cloudflare Access identity is incomplete.');
  }
  const email = payload.email.trim().toLowerCase();
  if (!email) throw new Error('Cloudflare Access identity is incomplete.');
  return {
    subject: payload.sub.trim(),
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

function hasAttributeValue(tag: string, name: string, value: string): boolean {
  return new RegExp(`\\b${name}\\s*=\\s*(?:["']${value}["']|${value})(?=\\s|/?>)`, 'i').test(tag);
}

function setCredentialedCrossOrigin(tag: string): string {
  const existing = /\bcrossorigin\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
  if (existing.test(tag)) return tag.replace(existing, 'crossorigin="use-credentials"');
  const closingLength = tag.endsWith('/>') ? 2 : 1;
  return `${tag.slice(0, -closingLength)} crossorigin="use-credentials"${tag.slice(-closingLength)}`;
}

function credentializeModuleAssets(html: string): string {
  return html
    .replace(/<script\b[^>]*>/gi, (tag) => (
      hasAttributeValue(tag, 'type', 'module') && /\bsrc\s*=/i.test(tag)
        ? setCredentialedCrossOrigin(tag)
        : tag
    ))
    .replace(/<link\b[^>]*>/gi, (tag) => (
      hasAttributeValue(tag, 'rel', 'modulepreload') && /\bhref\s*=/i.test(tag)
        ? setCredentialedCrossOrigin(tag)
        : tag
    ));
}

async function withCredentialedModuleAssets(response: Response): Promise<Response> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) return response;

  type RewriterElement = { setAttribute(name: string, value: string): void };
  type Rewriter = {
    on(selector: string, handlers: { element(element: RewriterElement): void }): Rewriter;
    transform(input: Response): Response;
  };
  const NativeHtmlRewriter = Reflect.get(globalThis, 'HTMLRewriter') as (new () => Rewriter) | undefined;
  if (NativeHtmlRewriter) {
    const credentialHandler = {
      element(element: RewriterElement) {
        element.setAttribute('crossorigin', 'use-credentials');
      },
    };
    return new NativeHtmlRewriter()
      .on('script[type="module"][src]', credentialHandler)
      .on('link[rel="modulepreload"][href]', credentialHandler)
      .transform(response);
  }

  // Node-based production previews do not expose Cloudflare's streaming HTMLRewriter.
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(credentializeModuleAssets(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createAccessGuard(
  handler: WorkerHandler,
  verify: VerifyAccessToken = verifyAccessJwt,
  allowLocalSitesIdentity = false,
) {
  return {
    async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === 'GET' && isPublicPath(url.pathname)) {
        return withCredentialedModuleAssets(await handler.fetch(request, env, ctx));
      }

      const localIdentity = allowLocalSitesIdentity ? localSitesIdentity(request) : null;
      if (localIdentity) {
        return withCredentialedModuleAssets(
          await handler.fetch(withVerifiedIdentity(request, localIdentity), env, ctx),
        );
      }

      const token = request.headers.get('cf-access-jwt-assertion');
      if (!token) return authenticationRequired();
      let identity: VerifiedAccessIdentity;
      try {
        identity = await verify(token, readAccessConfig(env));
      } catch {
        return authenticationRequired();
      }
      return withCredentialedModuleAssets(
        await handler.fetch(withVerifiedIdentity(request, identity), env, ctx),
      );
    },
  };
}

function isPublicPath(pathname: string): boolean {
  return pathname === '/login'
    || pathname === '/api/catalog'
    || pathname.startsWith('/_next/')
    || /\.(?:css|js|map|png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(pathname);
}
