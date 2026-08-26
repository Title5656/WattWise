'use client';

import Link from 'next/link';
import { useState } from 'react';

type ActivePage = 'status' | 'home' | 'profile' | 'settings';

type SidebarLink = {
  id: ActivePage;
  label: string;
  detail: string;
  icon: string;
  href: string;
  badge?: string;
};

const links: readonly SidebarLink[] = [
  { id: 'status', label: 'Status', detail: 'ภาพรวมพลังงานทั้งหมด', icon: '◫', href: '/#overview', badge: 'LIVE' },
  { id: 'home', label: 'My Home', detail: 'จัดการเครื่องใช้ไฟฟ้าในบ้าน', icon: '⌂', href: '/my-home', badge: 'BUILD' },
  { id: 'profile', label: 'Profile', detail: 'แก้ไขข้อมูลและบัญชีผู้ใช้', icon: '◎', href: '/#profile' },
  { id: 'settings', label: 'Settings', detail: 'ตั้งค่าระบบและการแจ้งเตือน', icon: '⚙', href: '/#settings' },
];

export function WattWiseSidebar({ active }: { active: ActivePage }) {
  const [open, setOpen] = useState(false);

  return <>
    <button className="mobile-sidebar-toggle" onClick={() => setOpen(true)} aria-label="เปิดเมนู">☰</button>
    <button className={`sidebar-scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-label="ปิดเมนู" />
    <aside className={`sidebar ${open ? 'mobile-open' : ''}`}>
      <div className="sidebar-top">
        <Link className="brand" href="/#overview" onClick={() => setOpen(false)}><span className="brand-mark">W</span><span><b>WattWise</b><small>HOME ENERGY</small></span></Link>
        <button className="sidebar-close" onClick={() => setOpen(false)} aria-label="ปิดเมนู">×</button>
      </div>
      <nav className="side-nav" aria-label="เมนูหลัก">
        <p>MAIN MENU</p>
        {links.map((link) => <Link
          className={active === link.id ? 'active' : ''}
          href={link.href}
          key={link.id}
          onClick={() => setOpen(false)}
          aria-current={active === link.id ? 'page' : undefined}
        >
          <i>{link.icon}</i><span><b>{link.label}</b><small>{link.detail}</small></span>{link.badge ? <em>{link.badge}</em> : null}
        </Link>)}
      </nav>
      <div className="sidebar-account" id="profile"><i>WP</i><span><b>วรปรัชญ์</b><small>บ้านของฉัน · ออนไลน์</small></span><button aria-label="เปิดโปรไฟล์">›</button></div>
    </aside>
  </>;
}
