'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeDisplayName } from '@/lib/auth-navigation';
import type { CurrentUser } from '@/lib/household-ui';

export function DisplayNameForm({ user, submitLabel, onSaved }: { user: CurrentUser; submitLabel: string; onSaved: (user: CurrentUser) => void }) {
  const router = useRouter();
  const suggestedName = user.displayName && user.displayName !== user.email ? user.displayName : '';
  const [displayName, setDisplayName] = useState(suggestedName);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeDisplayName(displayName);
    if (normalized.error) { setError(normalized.error); return; }
    setPhase('saving'); setError('');
    try {
      const response = await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: normalized.value }) });
      if (response.status === 401) { router.replace(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`); return; }
      const result = await response.json() as { user?: CurrentUser; message?: string };
      if (!response.ok || !result.user) throw new Error(result.message || 'บันทึกชื่อไม่สำเร็จ');
      setDisplayName(result.user.displayName || normalized.value); setPhase('saved'); onSaved(result.user);
    } catch (caught) {
      setPhase('idle'); setError(caught instanceof Error ? caught.message : 'บันทึกชื่อไม่สำเร็จ');
    }
  }

  return <form className="display-name-form" onSubmit={submit} noValidate>
    <label htmlFor="display-name">ชื่อที่ใช้แสดง</label><p>ชื่อนี้จะปรากฏในคำทักทาย โปรไฟล์ และรายชื่อสมาชิกบ้านแทนอีเมล</p>
    <Input id="display-name" name="displayName" value={displayName} maxLength={50} autoComplete="name" autoFocus onChange={(event) => { setDisplayName(event.target.value); setError(''); setPhase('idle'); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'display-name-error' : 'display-name-help'} />
    <div className="display-name-meta"><small id="display-name-help">1–50 ตัวอักษร · แก้ไขภายหลังได้</small><small>{[...displayName].length}/50</small></div>
    {error && <p className="account-error" id="display-name-error" role="alert">{error}</p>}
    {phase === 'saved' && <p className="account-success" role="status"><Check aria-hidden="true" />บันทึกชื่อแล้ว</p>}
    <Button type="submit" disabled={phase === 'saving'}>{phase === 'saving' ? <LoaderCircle className="state-spinner" aria-hidden="true" /> : null}{submitLabel}<ArrowRight aria-hidden="true" /></Button>
  </form>;
}
