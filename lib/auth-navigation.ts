export type DisplayNameResult = { value: string; error: string };

export function normalizeDisplayName(input: unknown): DisplayNameResult {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return { value, error: 'กรุณากรอกชื่อที่ต้องการให้แสดง' };
  if ([...value].length > 50) return { value, error: 'ชื่อต้องยาวไม่เกิน 50 ตัวอักษร' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    return { value, error: 'ชื่อนี้ดูเหมือนอีเมล กรุณาใช้ชื่อที่ต้องการให้ผู้อื่นเห็น' };
  }
  return { value, error: '' };
}

export function safeReturnTo(input: string | null | undefined): string {
  if (!input || !input.startsWith('/') || input.startsWith('//')) return '/';
  if (input === '/login' || input.startsWith('/login?') || input === '/auth/start') return '/';
  return input;
}
