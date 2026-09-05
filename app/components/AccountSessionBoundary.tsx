'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { watchSessionLogout } from '@/lib/session-logout';
import { hasUnsavedForms } from '@/lib/unsaved-forms';

export function AccountSessionBoundary({ children }: { children: ReactNode }) {
  const [ended, setEnded] = useState(false);

  useEffect(() => watchSessionLogout(() => flushSync(() => setEnded(true))), []);

  useEffect(() => {
    const warning = 'มีข้อมูลบ้านที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?';
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedForms()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (!hasUnsavedForms() || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
      const target = new URL(link.href);
      if (target.pathname === location.pathname && target.search === location.search) return;
      if (!window.confirm(warning)) { event.preventDefault(); event.stopPropagation(); }
    };
    // Modern browsers expose cancellable same-document Back/Forward navigation.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      const traversal = event as Event & { navigationType?: string };
      if (traversal.navigationType === 'traverse' && event.cancelable && hasUnsavedForms() && !window.confirm(warning)) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    navigation?.addEventListener('navigate', navigate);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
      navigation?.removeEventListener('navigate', navigate);
    };
  }, []);

  if (ended) return <main className="household-entry-shell"><Card className="household-state-card" role="status">
    <h1>หยุดใช้งานบัญชีในแท็บนี้แล้ว</h1>
    <p>มีการขอออกจากระบบ ข้อมูลบ้านถูกซ่อนแล้ว ฉบับร่างอุปกรณ์จะเก็บไว้สำหรับบัญชีเดิม</p>
    <Button onClick={() => {
      // A fresh document must pass the Access gateway and reset this session boundary.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/');
    }}>เข้าสู่ระบบอีกครั้ง</Button>
  </Card></main>;
  return children;
}
