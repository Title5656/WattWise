'use client';

import Link from 'next/link';
import Image from 'next/image';
import { House, LayoutDashboard, Settings, UserRound } from 'lucide-react';
import { householdDashboardPath, householdMyHomePath } from '@/lib/household-ui';

type ActivePage = 'status' | 'home' | 'profile' | 'settings';

export function WattWiseSidebar({ active, householdId, homeItemCount }: { active: ActivePage; householdId?: string; homeItemCount?: number }) {
  const dashboardPath = householdId ? householdDashboardPath(householdId) : '/';
  const myHomePath = householdId ? householdMyHomePath(householdId) : '/my-home';
  const links = [
    { id: 'status', label: 'ภาพรวม', icon: LayoutDashboard, href: `${dashboardPath}#overview` },
    { id: 'home', label: 'My Home', icon: House, href: myHomePath },
    { id: 'profile', label: 'บัญชีและบ้าน', icon: UserRound, href: '/profile' },
    { id: 'settings', label: 'ตั้งค่า', icon: Settings, href: '/settings' },
  ] as const;
  return <header className="sidebar">
    <a className="skip-link" href="#page-content">ข้ามไปเนื้อหา</a>
    <Link className="brand" href={`${dashboardPath}#overview`}><Image src="/wattwise-logo-small.png" alt="" width={36} height={36} priority /><b>WattWise</b></Link>
    <nav className="side-nav" aria-label="เมนูหลัก">
      {links.map((link) => { const Icon = link.icon; return <Link className={active === link.id ? 'active' : ''} href={link.href} key={link.id} aria-current={active === link.id ? 'page' : undefined}><Icon aria-hidden="true" /><span>{link.label}</span></Link>; })}
    </nav>
    <Link className="sidebar-account" href={myHomePath} aria-label="ไปจัดการอุปกรณ์ใน My Home"><House aria-hidden="true" /><small>{!householdId ? 'เลือกบ้าน' : homeItemCount === undefined ? 'My Home' : `${homeItemCount} รายการในบ้าน`}</small></Link>
  </header>;
}
