import { safeReturnTo } from '@/lib/auth-navigation';

export function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL('/onboarding', url.origin);
  destination.searchParams.set('returnTo', safeReturnTo(url.searchParams.get('returnTo')));
  return Response.redirect(destination, 302);
}
