'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { DisplayNameForm } from '../components/DisplayNameForm';
import { safeReturnTo } from '@/lib/auth-navigation';
import type { CurrentUser } from '@/lib/household-ui';

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/me', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (response.status === 401) { window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`); return; }
      const result = await response.json() as { user?: CurrentUser; message?: string };
      if (!response.ok || !result.user) throw new Error(result.message || 'โหลดข้อมูลบัญชีไม่สำเร็จ');
      if (!result.user.needsDisplayName) { router.replace(returnTo); return; }
      setUser(result.user);
    }).catch((caught) => {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'โหลดข้อมูลบัญชีไม่สำเร็จ');
    });
    return () => controller.abort();
  }, [returnTo, router]);
  return <main className="onboarding-shell">
    <header className="onboarding-brand"><Image src="/wattwise-logo-small.png" alt="" width={42} height={42} /><span><b>WattWise</b><small>HOME ENERGY</small></span></header>
    <section className="onboarding-card"><span className="onboarding-step">ขั้นตอนสุดท้าย</span><i className="onboarding-avatar"><UserRound aria-hidden="true" /></i><h1>อยากให้เราเรียกคุณว่าอะไร?</h1><p>เลือกชื่อที่คนในบ้านจำได้ง่าย เราจะใช้ชื่อนี้แทนอีเมลในหน้าต่าง ๆ</p>
      {error ? <p className="account-error" role="alert">{error}</p> : user ? <DisplayNameForm user={user} submitLabel="ยืนยันและเริ่มใช้งาน" onSaved={() => router.replace(returnTo)} /> : <p className="onboarding-loading" role="status">กำลังเตรียมข้อมูลบัญชี…</p>}
    </section>
  </main>;
}
