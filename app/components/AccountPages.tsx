'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ArrowRight, House, LogOut, Pencil, Plus, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { canManageHousehold, displayUserName, householdDashboardPath, householdMyHomePath, householdRoleLabel, type CurrentUser, type HouseholdMembership } from '@/lib/household-ui';
import { logoutFromAccess } from '@/lib/session-logout';
import { hasUnsavedForms } from '@/lib/unsaved-forms';
import { HouseholdAccessState } from './HouseholdAccessState';
import { HouseholdForm } from './HouseholdForm';
import { DisplayNameForm } from './DisplayNameForm';
import { useHouseholdMemberships } from './use-household-memberships';
import { WattWiseSidebar } from './WattWiseSidebar';

function AccountShell({ active, title, children }: { active: 'profile' | 'settings'; title: string; children: ReactNode }) {
  return <div className="dashboard-shell"><WattWiseSidebar active={active} />
    <main className="dashboard-content account-content" id="page-content" tabIndex={-1}>
      <header className="account-heading"><p className="kicker">บัญชีผู้ใช้</p><h1>{title}</h1></header>{children}
    </main>
  </div>;
}

function UserCard({ user }: { user: CurrentUser }) {
  return <Card className="account-card account-user"><UserRound aria-hidden="true" /><div>
    <h2>{displayUserName(user)}</h2><p>{user.email}</p><span className="account-muted">บัญชีที่กำลังใช้งาน · ข้อมูลจากการเข้าสู่ระบบ</span>
  </div></Card>;
}

function HouseholdCard({ household, editing, onEdit, onCancel, onSaved }: {
  household: HouseholdMembership; editing: boolean; onEdit: () => void; onCancel: () => void; onSaved: () => void;
}) {
  return <Card className="account-card">
    <div className="account-card-heading"><House aria-hidden="true" /><div><h3>{household.name}</h3><span className="account-muted">{householdRoleLabel(household.role)}</span></div></div>
    {editing ? <HouseholdForm household={household} onSaved={onSaved} onCancel={onCancel} /> : <>
      <dl className="account-details"><div><dt>จังหวัด</dt><dd>{household.province || 'ยังไม่ระบุ'}</dd></div><div><dt>ผู้ให้บริการไฟฟ้า</dt><dd>{household.electricityProvider || 'ยังไม่ระบุ'}</dd></div></dl>
      <div className="account-actions">
        <Button asChild><Link href={householdDashboardPath(household.id)}>เปิดบ้าน <ArrowRight aria-hidden="true" /></Link></Button>
        <Button asChild variant="outline"><Link href={householdMyHomePath(household.id)}>เครื่องใช้ไฟฟ้า</Link></Button>
        {canManageHousehold(household.role) && <Button variant="ghost" onClick={onEdit}><Pencil aria-hidden="true" />แก้ไขข้อมูลบ้าน</Button>}
      </div>
      {!canManageHousehold(household.role) && <p className="account-muted">เฉพาะเจ้าของบ้านและผู้ดูแลที่แก้ไขข้อมูลบ้านได้</p>}
    </>}
  </Card>;
}

export function ProfilePage() {
  const context = useHouseholdMemberships();
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  return <AccountShell active="profile" title="บัญชีและบ้านของคุณ">
    {context.phase !== 'ready' || !context.user ? <HouseholdAccessState embedded phase={context.phase === 'ready' ? 'error' : context.phase} error={context.error} onRefresh={() => void context.refresh()} /> : <>
      <UserCard user={context.user} />
      <Card className="account-card account-form-card"><h2>ชื่อที่ใช้แสดง</h2>
        <DisplayNameForm user={context.user} submitLabel="บันทึกชื่อ" onSaved={() => {
          setMessage('บันทึกชื่อที่ใช้แสดงแล้ว');
          void context.refresh();
        }} />
      </Card>
      <section aria-label="บ้านของคุณ"><div className="account-section-heading"><h2>บ้านของคุณ <span>({context.households.length})</span></h2><Button asChild><Link href="/households/new"><Plus aria-hidden="true" />เพิ่มบ้าน</Link></Button></div>
        {message && <p className="account-success" role="status">{message}</p>}
        {context.households.length === 0 && <Card className="account-card"><h3>ยังไม่มีบ้าน</h3><p className="account-muted">เพิ่มบ้านหลังแรกเพื่อเริ่มจัดการเครื่องใช้ไฟฟ้าและดูภาพรวมพลังงาน</p></Card>}
        <div className="account-households">{context.households.map((household) => <HouseholdCard key={`${context.user!.id}:${household.id}:${household.role}`} household={household}
          editing={editingId === household.id} onCancel={() => setEditingId(null)} onEdit={() => {
            if (hasUnsavedForms() && !window.confirm('ข้อมูลบ้านที่กำลังแก้ไขยังไม่ได้บันทึก ต้องการเปลี่ยนบ้านหรือไม่?')) return;
            setMessage('');
            setEditingId(household.id);
          }} onSaved={() => {
          setEditingId(null);
          setMessage('บันทึกข้อมูลบ้านแล้ว');
          void context.refresh();
        }} />)}</div>
      </section>
    </>}
  </AccountShell>;
}

export function NewHouseholdPage() {
  const context = useHouseholdMemberships();
  const router = useRouter();
  return <AccountShell active="profile" title="เพิ่มบ้าน">
    {context.phase !== 'ready' || !context.user ? <HouseholdAccessState embedded phase={context.phase === 'ready' ? 'error' : context.phase} error={context.error} onRefresh={() => void context.refresh()} /> : <Card className="account-card account-form-card">
      <h2>ข้อมูลบ้านหลังใหม่</h2><p className="account-muted">ข้อมูลอุปกรณ์และบิลของแต่ละบ้านจะแยกจากกัน</p>
      <HouseholdForm key={context.user.id} onSaved={(household) => router.replace(householdDashboardPath(household.id))} onCancel={() => router.push('/profile')} />
    </Card>}
  </AccountShell>;
}

export function SettingsPage({ logoutEnabled }: { logoutEnabled: boolean }) {
  const context = useHouseholdMemberships();
  return <AccountShell active="settings" title="ตั้งค่า">
    {context.phase !== 'ready' || !context.user ? <HouseholdAccessState embedded phase={context.phase === 'ready' ? 'error' : context.phase} error={context.error} onRefresh={() => void context.refresh()} /> : <>
      <UserCard user={context.user} />
      <Card className="account-card account-form-card"><h2>การเข้าสู่ระบบ</h2>
        <p>ออกจากระบบบนเบราว์เซอร์นี้ โดยข้อมูลบ้านและอุปกรณ์ที่บันทึกไว้ยังอยู่</p>
        <p className="account-muted">การออกจากระบบจะยุติเซสชัน Cloudflare Access รวมถึงบริการอื่นในทีมเดียวกัน ไม่ได้ออกจากบัญชี Google ของคุณ</p>
        <p className="account-muted">ฉบับร่างอุปกรณ์ที่ยังส่งไม่สำเร็จจะเก็บไว้ในเบราว์เซอร์สำหรับบัญชีเดิม</p>
        {logoutEnabled ? <Button className="account-logout" onClick={logoutFromAccess}><LogOut aria-hidden="true" />ออกจากระบบ</Button> : <p role="status" className="account-muted">โหมดพัฒนาในเครื่องไม่ได้ใช้เซสชัน Cloudflare Access กรุณาทดสอบการออกจากระบบบนเว็บไซต์จริง</p>}
      </Card>
    </>}
  </AccountShell>;
}
