'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { ChevronRight, House, LayoutDashboard, Menu, Settings, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { householdDashboardPath, householdMyHomePath } from '@/lib/household-ui';

type ActivePage = 'status' | 'home' | 'profile' | 'settings';

export function WattWiseSidebar({ active, householdId, homeItemCount }: { active: ActivePage; householdId: string; homeItemCount?: number }) {
  const [open, setOpen] = useState(false);
  const dashboardPath = householdDashboardPath(householdId);
  const myHomePath = householdMyHomePath(householdId);
  const links = [
    { id: 'status', label: 'Status', detail: 'ภาพรวมพลังงานทั้งหมด', icon: LayoutDashboard, href: `${dashboardPath}#overview`, badge: 'LIVE' },
    { id: 'home', label: 'My Home', detail: 'จัดการเครื่องใช้ไฟฟ้าในบ้าน', icon: House, href: myHomePath, badge: 'BUILD' },
    { id: 'profile', label: 'Profile', detail: 'แก้ไขข้อมูลและบัญชีผู้ใช้', icon: UserRound, href: `${dashboardPath}#profile`, badge: undefined },
    { id: 'settings', label: 'Settings', detail: 'ตั้งค่าระบบและการแจ้งเตือน', icon: Settings, href: `${dashboardPath}#settings`, badge: undefined },
  ] as const;

  return <>
    <Button variant="ghost" size="icon" className="mobile-sidebar-toggle" onClick={() => setOpen(true)} aria-label="เปิดเมนู"><Menu aria-hidden="true" /></Button>
    <Button variant="ghost" className={`sidebar-scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-label="ปิดเมนู" />
    <aside className={`sidebar ${open ? 'mobile-open' : ''}`}>
      <div className="sidebar-top">
        <Link className="brand" href={`${dashboardPath}#overview`} onClick={() => setOpen(false)}><span className="brand-mark"><Image src="/wattwise-logo-small.png" alt="WattWise" width={40} height={40} priority /></span><span><b>WattWise</b><small>HOME ENERGY</small></span></Link>
        <Button variant="ghost" size="icon" className="sidebar-close" onClick={() => setOpen(false)} aria-label="ปิดเมนู"><X aria-hidden="true" /></Button>
      </div>
      <nav className="side-nav" aria-label="เมนูหลัก">
        <p>MAIN MENU</p>
        {links.map((link) => {
          const Icon = link.icon;
          return <Link
          className={active === link.id ? 'active' : ''}
          href={link.href}
          key={link.id}
          onClick={() => setOpen(false)}
          aria-current={active === link.id ? 'page' : undefined}
        >
          <i><Icon aria-hidden="true" /></i><span><b>{link.label}</b><small>{link.detail}</small></span>{link.badge ? <em>{link.badge}</em> : null}
        </Link>;})}
      </nav>
      <Link className="sidebar-account" href={myHomePath} onClick={() => setOpen(false)} aria-label="ไปจัดการอุปกรณ์ใน My Home">
        <i className="sidebar-home-icon"><House aria-hidden="true" /><span /></i>
        <span><b>สถานะบ้าน</b><small>{homeItemCount === undefined ? 'กำลังเชื่อมข้อมูลบ้าน' : `${homeItemCount} อุปกรณ์ · ออนไลน์`}</small></span>
        <ChevronRight aria-hidden="true" />
      </Link>
    </aside>
  </>;
}
