export type SitesIdentity = {
  provider: 'openai-sites';
  subject: string;
  email: string;
  displayName: string;
};

const PROVIDER = 'openai-sites' as const;
const SUBJECT_HEADER = 'oai-authenticated-user-id';
const EMAIL_HEADER = 'oai-authenticated-user-email';
const FULL_NAME_HEADER = 'oai-authenticated-user-full-name';
const FULL_NAME_ENCODING_HEADER = 'oai-authenticated-user-full-name-encoding';

export function getCurrentIdentity(request: Request): SitesIdentity | null {
  const subject = request.headers.get(SUBJECT_HEADER)?.trim();
  const email = request.headers.get(EMAIL_HEADER)?.trim().toLowerCase();

  if (!subject || !email) return null;

  return {
    provider: PROVIDER,
    subject,
    email,
    displayName: decodeDisplayName(request) ?? email,
  };
}

function decodeDisplayName(request: Request): string | null {
  if (request.headers.get(FULL_NAME_ENCODING_HEADER) !== 'percent-encoded-utf-8') return null;

  const encodedName = request.headers.get(FULL_NAME_HEADER);
  if (!encodedName) return null;

  try {
    return decodeURIComponent(encodedName).trim() || null;
  } catch {
    return null;
  }
}
