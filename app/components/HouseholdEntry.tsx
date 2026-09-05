'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, House, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { decideHouseholdEntry, displayUserName, householdDestinationPath, householdRoleLabel, type HouseholdDestination } from '@/lib/household-ui';
import { HouseholdAccessState } from './HouseholdAccessState';
import { HouseholdForm } from './HouseholdForm';
import { useHouseholdMemberships } from './use-household-memberships';

export function HouseholdEntry({ destination }: { destination: HouseholdDestination }) {
  const router = useRouter();
  const { phase, user, households, error, refresh } = useHouseholdMemberships();
  const decision = useMemo(() => phase === 'ready' ? decideHouseholdEntry(households, destination) : null, [destination, households, phase]);
  useEffect(() => {
    if (decision?.kind === 'redirect') router.replace(decision.href);
  }, [decision, router]);

  if (phase !== 'ready') return <HouseholdAccessState phase={phase} error={error} onRefresh={() => void refresh()} />;
  if (!user || !decision || decision.kind === 'redirect') return <HouseholdAccessState phase="loading" />;

  return <main className="household-entry-shell">
    <section className="household-entry-content">
      <header><p className="kicker">WATTWISE · HOUSEHOLDS</p><h1>{decision.kind === 'create' ? 'สร้างบ้านหลังแรกของคุณ' : 'เลือกบ้านที่ต้องการ'}</h1><span>สวัสดี {displayUserName(user)} · ข้อมูลแต่ละบ้านแยกจากกันอย่างชัดเจน</span></header>
      <nav className="account-actions entry-account-nav" aria-label="บัญชีและบ้าน">
        <Button asChild variant="outline"><Link href="/profile">Profile</Link></Button>
        <Button asChild variant="outline"><Link href="/settings">Settings</Link></Button>
        {decision.kind !== 'create' && <Button asChild><Link href="/households/new"><Plus aria-hidden="true" />เพิ่มบ้าน</Link></Button>}
      </nav>
      {decision.kind === 'create' ? <Card className="account-card account-form-card">
        <HouseholdForm key={user.id} onSaved={(household) => router.replace(householdDestinationPath(household.id, 'dashboard'))} />
      </Card> : <div className="household-choice-grid" role="list">
        {households.map((household) => <Card className="household-choice-card" role="listitem" key={household.id}>
          <i><House aria-hidden="true" /></i><div><h2>{household.name}</h2><p>{household.province || 'ไม่ได้ระบุจังหวัด'} · {householdRoleLabel(household.role)}</p></div>
          <Button asChild variant="outline"><Link href={householdDestinationPath(household.id, destination)}>เปิดบ้าน <ArrowRight aria-hidden="true" /></Link></Button>
        </Card>)}
      </div>}
    </section>
  </main>;
}
