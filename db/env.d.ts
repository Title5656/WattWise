declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
    CLOUDFLARE_ACCESS_AUD?: string;
  }
}
