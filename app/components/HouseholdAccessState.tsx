import Link from 'next/link';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function HouseholdAccessState({
  phase,
  error,
  onRefresh,
}: {
  phase: 'loading' | 'session-expired' | 'access-denied' | 'error';
  error?: string;
  onRefresh?: () => void;
}) {
  const loading = phase === 'loading';
  const title = loading
    ? 'กำลังโหลดข้อมูลบ้าน'
    : phase === 'session-expired'
      ? 'เซสชันหมดอายุ'
      : phase === 'access-denied'
        ? 'ไม่สามารถเข้าถึงบ้านนี้ได้'
        : 'โหลดข้อมูลไม่สำเร็จ';
  const detail = loading
    ? 'กำลังตรวจสอบบัญชีและสิทธิ์สมาชิก'
    : phase === 'session-expired'
      ? 'กรุณาเข้าสู่ระบบอีกครั้ง แล้วกลับมาที่หน้านี้'
      : phase === 'access-denied'
        ? 'บ้านนี้อาจถูกลบ หรือบัญชีของคุณไม่ได้เป็นสมาชิกแล้ว'
        : error || 'กรุณาลองใหม่อีกครั้ง';

  return <main className="household-entry-shell">
    <Card className="household-state-card" role={loading ? 'status' : 'alert'} aria-live="polite">
      <i>{loading ? <LoaderCircle className="state-spinner" aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}</i>
      <h1>{title}</h1>
      <p>{detail}</p>
      {!loading && <div className="household-state-actions">
        {onRefresh && <Button type="button" onClick={onRefresh}>ตรวจสอบบัญชีและสิทธิ์อีกครั้ง</Button>}
        <Button asChild variant="outline"><Link href="/">กลับหน้าเลือกบ้าน</Link></Button>
      </div>}
    </Card>
  </main>;
}
