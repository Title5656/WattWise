export type CloudflareAccessIdentity = {
  provider: 'cloudflare-access';
  subject: string;
  email: string;
  displayName: string;
};

const PROVIDER = 'cloudflare-access' as const;
const SUBJECT_HEADER = 'x-wattwise-auth-subject';
const EMAIL_HEADER = 'x-wattwise-auth-email';
const NAME_HEADER = 'x-wattwise-auth-name';

export function getCurrentIdentity(request: Request): CloudflareAccessIdentity | null {
  const subject = request.headers.get(SUBJECT_HEADER)?.trim();
  const email = request.headers.get(EMAIL_HEADER)?.trim().toLowerCase();

  if (!subject || !email) return null;

  return {
    provider: PROVIDER,
    subject,
    email,
    displayName: request.headers.get(NAME_HEADER)?.trim() || email,
  };
}
