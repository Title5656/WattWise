declare namespace Cloudflare {
  interface Env {
    ASSETS?: {
      fetch(request: Request): Promise<Response> | Response;
    };
    DB: D1Database;
    CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
    CLOUDFLARE_ACCESS_AUD?: string;
  }
}
