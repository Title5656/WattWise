'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, House, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  decideHouseholdEntry,
  displayUserName,
  householdDestinationPath,
  householdRoleLabel,
  type HouseholdDestination,
  type HouseholdMembership,
} from '@/lib/household-ui';
import { HouseholdAccessState } from './HouseholdAccessState';
import { useHouseholdMemberships } from './use-household-memberships';

export function HouseholdEntry({ destination }: { destination: HouseholdDestination }) {
  const router = useRouter();
  const { phase, user, households, error } = useHouseholdMemberships();
  const decision = useMemo(
    () => phase === 'ready' ? decideHouseholdEntry(households, destination) : null,
    [destination, households, phase],
  );
  const [name, setName] = useState('');
  const [province, setProvince] = useState('');
  const [electricityProvider, setElectricityProvider] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (decision?.kind === 'redirect') router.replace(decision.href);
  }, [decision, router]);

  async function createHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const response = await fetch('/api/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          province: province.trim() || undefined,
          electricityProvider: electricityProvider.trim() || undefined,
        }),
      });
      if (response.status === 401) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      const body = await response.json() as { household?: HouseholdMembership; error?: string };
      if (!response.ok || !body.household) throw new Error(body.error ?? 'สร้างบ้านไม่สำเร็จ');
      router.replace(householdDestinationPath(body.household.id, destination));
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'สร้างบ้านไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  }

  if (phase !== 'ready') return <HouseholdAccessState phase={phase} error={error} />;
  if (!user || !decision || decision.kind === 'redirect') {
    return <HouseholdAccessState phase="loading" />;
  }

  return <main className="household-entry-shell">
    <section className="household-entry-content">
      <header><p className="kicker">WATTWISE · HOUSEHOLDS</p><h1>{decision.kind === 'create' ? 'สร้างบ้านหลังแรกของคุณ' : 'เลือกบ้านที่ต้องการ'}</h1><span>สวัสดี {displayUserName(user)} · ข้อมูลแต่ละบ้านแยกจากกันอย่างชัดเจน</span></header>
      {decision.kind === 'create' ? <Card className="household-create-card">
        <div className="household-entry-icon"><Plus aria-hidden="true" /></div>
        <form onSubmit={createHousehold}>
          <label>ชื่อบ้าน<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required placeholder="เช่น บ้านสวน" /></label>
          <label>จังหวัด <small>ไม่บังคับ</small><Input value={province} onChange={(event) => setProvince(event.target.value)} maxLength={100} /></label>
          <label>ผู้ให้บริการไฟฟ้า <small>ไม่บังคับ</small><Input value={electricityProvider} onChange={(event) => setElectricityProvider(event.target.value)} maxLength={50} placeholder="เช่น PEA หรือ MEA" /></label>
          {createError && <p role="alert">{createError}</p>}
          <Button type="submit" disabled={creating}>{creating ? 'กำลังสร้าง...' : 'สร้างบ้านและเริ่มใช้งาน'} <ArrowRight aria-hidden="true" /></Button>
        </form>
      </Card> : <div className="household-choice-grid" role="list">
        {households.map((household) => <Card className="household-choice-card" role="listitem" key={household.id}>
          <i><House aria-hidden="true" /></i><div><h2>{household.name}</h2><p>{household.province || 'ไม่ได้ระบุจังหวัด'} · {householdRoleLabel(household.role)}</p></div>
          <Button asChild variant="outline"><Link href={householdDestinationPath(household.id, destination)}>เปิดบ้าน <ArrowRight aria-hidden="true" /></Link></Button>
        </Card>)}
      </div>}
    </section>
  </main>;
}
