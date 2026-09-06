'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { createDashboardLifecycle, runDashboardMutation } from '@/lib/dashboard-lifecycle';
import { householdContentScopeKey } from '@/lib/household-client-lifecycle';
import { calculateDailyLoadProfile, calculateHomeSummary, type HomeAppliance } from '@/lib/home-config';
import {
  canEditHousehold,
  householdBillApiPath,
  householdDashboardApiPath,
  householdMyHomePath,
  type CurrentUser,
  type HouseholdMembership,
} from '@/lib/household-ui';
import { createLatestRequestTracker, isAbortError } from '@/lib/latest-request';
import { formatBillingMonthLabel, getBillingMonth, selectRecentRecords, type MonthlyEnergyRecord } from '@/lib/monthly-history';
import { HouseholdAccessState } from './HouseholdAccessState';
import { HouseholdIdentityBar } from './HouseholdIdentityBar';
import { WattWiseSidebar } from './WattWiseSidebar';
import { useHouseholdContext } from './use-household-memberships';

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value);
}

export function HouseholdDashboard({ householdId }: { householdId: string }) {
  const context = useHouseholdContext(householdId);
  if (context.phase !== 'ready') {
    return <HouseholdAccessState
      phase={context.phase}
      error={context.error}
      onRefresh={() => void context.refresh()}
    />;
  }
  if (!context.user || !context.household) return <HouseholdAccessState phase="error" />;
  return <HouseholdDashboardContent
    key={householdContentScopeKey(context.user, context.household)}
    householdId={householdId}
    user={context.user}
    household={context.household}
    households={context.households}
    onRefreshMemberships={context.refresh}
  />;
}

function HouseholdDashboardContent({
  householdId,
  user,
  household,
  households,
  onRefreshMemberships,
}: {
  householdId: string;
  user: CurrentUser;
  household: HouseholdMembership;
  households: HouseholdMembership[];
  onRefreshMemberships: () => Promise<void>;
}) {
  const [homeItems, setHomeItems] = useState<HomeAppliance[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [history, setHistory] = useState<MonthlyEnergyRecord[]>([]);
  const [pagePhase, setPagePhase] = useState<'ready' | 'session-expired' | 'access-denied' | 'error'>('ready');
  const [billFormOpen, setBillFormOpen] = useState(false);
  const [billMonth, setBillMonth] = useState(() => getBillingMonth());
  const [actualBill, setActualBill] = useState('');
  const [actualKwh, setActualKwh] = useState('');
  const [billEditingMonth, setBillEditingMonth] = useState<string | null>(null);
  const [billError, setBillError] = useState('');
  const [billSaving, setBillSaving] = useState(false);
  const dashboardRequests = useRef(createLatestRequestTracker());
  const dashboardLifecycle = useRef(createDashboardLifecycle());
  const canEdit = canEditHousehold(household.role);

  const refreshHome = useCallback(async () => {
    const lifecycleGeneration = dashboardLifecycle.current.currentGeneration();
    if (lifecycleGeneration === null) return;
    const request = dashboardRequests.current.begin();
    try {
      const response = await fetch(householdDashboardApiPath(householdId), {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!dashboardLifecycle.current.isCurrent(lifecycleGeneration)
        || !dashboardRequests.current.isLatest(request.generation)) return;
      if (response.status === 401) { setPagePhase('session-expired'); return; }
      if (response.status === 403 || response.status === 404) { setPagePhase('access-denied'); return; }
      if (!response.ok) throw new Error('load failed');
      const data = await response.json() as { items: HomeAppliance[]; history?: MonthlyEnergyRecord[] };
      if (!dashboardLifecycle.current.isCurrent(lifecycleGeneration)
        || !dashboardRequests.current.isLatest(request.generation)) return;
      setHomeItems(data.items);
      setHistory(data.history ?? []);
      setPagePhase('ready');
    } catch (error) {
      if (isAbortError(error) || !dashboardLifecycle.current.isCurrent(lifecycleGeneration)
        || !dashboardRequests.current.isLatest(request.generation)) return;
      setPagePhase('error');
    } finally {
      if (dashboardLifecycle.current.isCurrent(lifecycleGeneration)
        && dashboardRequests.current.isLatest(request.generation)) setHomeLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    const requests = dashboardRequests.current;
    const lifecycle = dashboardLifecycle.current;
    const lifecycleGeneration = lifecycle.mount();
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshHome(); };
    void Promise.resolve().then(refreshHome);
    window.addEventListener('focus', refreshHome);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      lifecycle.unmount(lifecycleGeneration);
      requests.cancel();
      window.removeEventListener('focus', refreshHome);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshHome]);

  const summary = useMemo(() => calculateHomeSummary(homeItems), [homeItems]);
  const itemEnergyById = useMemo(() => new Map(summary.itemCalculations.map((item) => [
    item.instanceId,
    item.calculation.monthlyEnergyKwh,
  ])), [summary.itemCalculations]);
  const values = useMemo(() => calculateDailyLoadProfile(homeItems), [homeItems]);
  const peak = Math.max(...values, 0);
  const chartPeak = Math.max(peak, 0.01);
  const averageLoad = summary.dailyKwh / 24;
  const hasEstimatedRange = !homeLoading && homeItems.length > 0;

  const monthlyBills = useMemo(() => selectRecentRecords(history), [history]);
  const monthlyPeak = Math.max(...monthlyBills.flatMap((bill) => [bill.estimatedBill ?? 0, bill.actualBill ?? 0]), 1);
  const topDevices = [...homeItems].sort((a, b) => (itemEnergyById.get(b.instanceId) ?? 0) - (itemEnergyById.get(a.instanceId) ?? 0)).slice(0, 4).map((item) => {
    const monthlyKwh = itemEnergyById.get(item.instanceId) ?? 0;
    const share = summary.monthlyKwh > 0 ? monthlyKwh / summary.monthlyKwh * 100 : 0;
    return { image: item.image, name: item.name, detail: `${item.brand} · ${item.model} · ${item.quantity} เครื่อง`, energy: `${formatNumber(monthlyKwh, 1)} kWh`, share: `${formatNumber(share)}% ของทั้งเดือน`, width: share };
  });

  function openBillForm(record?: MonthlyEnergyRecord) {
    if (!canEdit) return;
    setBillEditingMonth(record?.billingMonth ?? null);
    setBillMonth(record?.billingMonth ?? getBillingMonth());
    setActualBill(record?.actualBill === null || record?.actualBill === undefined ? '' : String(record.actualBill));
    setActualKwh(record?.actualKwh === null || record?.actualKwh === undefined ? '' : String(record.actualKwh));
    setBillError('');
    setBillFormOpen(true);
  }

  function closeBillForm() {
    if (billSaving) return;
    setBillFormOpen(false);
    setBillError('');
  }

  async function scopedMutationResponse(request: Promise<Response>) {
    const response = await request;
    if (response.status === 401) setPagePhase('session-expired');
    if (response.status === 403 || response.status === 404) setPagePhase('access-denied');
    return response;
  }

  async function saveBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    const lifecycleGeneration = dashboardLifecycle.current.currentGeneration();
    if (lifecycleGeneration === null) return;
    setBillSaving(true);
    setBillError('');
    await runDashboardMutation({
      lifecycle: dashboardLifecycle.current,
      generation: lifecycleGeneration,
      request: () => scopedMutationResponse(fetch(householdBillApiPath(householdId, billMonth), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualBill, actualKwh }),
      })),
      failureMessage: 'บันทึกบิลจริงไม่สำเร็จ',
      onSuccess: (data: { records?: MonthlyEnergyRecord[]; error?: string }) => {
        dashboardRequests.current.cancel();
        setHistory(data.records ?? []);
        setBillFormOpen(false);
      },
      onError: setBillError,
      onSettled: () => setBillSaving(false),
      refresh: refreshHome,
    });
  }

  async function deleteBill(month: string) {
    if (!canEdit || !window.confirm(`ลบบิลจริงของเดือน ${month} ใช่หรือไม่?`)) return;
    const lifecycleGeneration = dashboardLifecycle.current.currentGeneration();
    if (lifecycleGeneration === null) return;
    setBillError('');
    await runDashboardMutation({
      lifecycle: dashboardLifecycle.current,
      generation: lifecycleGeneration,
      request: () => scopedMutationResponse(fetch(householdBillApiPath(householdId, month), { method: 'DELETE' })),
      failureMessage: 'ลบบิลจริงไม่สำเร็จ',
      onSuccess: (data: { records?: MonthlyEnergyRecord[]; error?: string }) => {
        dashboardRequests.current.cancel();
        setHistory(data.records ?? []);
      },
      onError: setBillError,
      onSettled: () => undefined,
      refresh: refreshHome,
    });
  }

  if (pagePhase !== 'ready') {
    return <HouseholdAccessState phase={pagePhase} onRefresh={() => void onRefreshMemberships()} />;
  }
  const myHomePath = householdMyHomePath(householdId);

  return <div className="dashboard-shell">
    <WattWiseSidebar active="status" householdId={householdId} homeItemCount={homeLoading ? undefined : homeItems.length} />
    <main className="dashboard-content" id="page-content" tabIndex={-1}>
      <header className="dashboard-header" id="overview">
        <div><p className="kicker">ภาพรวมพลังงาน · {household.name}</p><h1>บ้านนี้ใช้ไฟเท่าไร</h1><span>{homeLoading ? 'กำลังเชื่อมข้อมูล My Home...' : `อัปเดตจาก My Home · ${summary.totalUnits} เครื่อง`}</span></div>
        <HouseholdIdentityBar user={user} household={household} households={households} destination="dashboard" />
      </header>

      {!canEdit && <section className="read-only-banner" role="status"><b>คุณมีสิทธิ์ดูข้อมูลเท่านั้น</b><span>บทบาทผู้ชมไม่สามารถแก้ไขอุปกรณ์ การใช้งาน หรือบิลของบ้านนี้ได้</span></section>}
      {homeLoading ? <section className="dashboard-loading" role="status"><span className="state-spinner" />กำลังโหลดอุปกรณ์และบิลของบ้าน…</section> : <>
      {!homeItems.length && <section className="dashboard-empty"><div><h2>เริ่มจากเครื่องใช้ไฟฟ้าในบ้าน</h2><p>เพิ่มอุปกรณ์และเวลาใช้งาน เพื่อประมาณค่าไฟของบ้านนี้</p></div><Button asChild><Link href={myHomePath}>เพิ่มเครื่องใช้ไฟฟ้า <Plus aria-hidden="true" /></Link></Button></section>}
      <section className="energy-overview" aria-label="ข้อมูลพลังงานสำคัญ">
        <div className="bill-estimate"><p className="kicker">ค่าไฟตามที่ตั้งไว้ · ต่อเดือน</p><div className="estimate-value"><strong>{homeItems.length ? formatNumber(summary.monthlyBill) : '—'}</strong><span>บาท</span></div><p>{summary.bill.tariffLabel ?? 'บ้านอยู่อาศัยทั่วไป'} · รวมค่าบริการ Ft และ VAT</p><Link href={myHomePath}>ปรับอุปกรณ์และเวลาใช้งาน <ArrowRight aria-hidden="true" /></Link></div>
        <div className="estimate-details"><div className="estimate-range"><h2>ช่วงค่าไฟโดยประมาณ</h2><b>{hasEstimatedRange ? '฿' + formatNumber(summary.monthlyBillRange.low) + '–' + formatNumber(summary.monthlyBillRange.high) : '—'}</b><p>{hasEstimatedRange ? 'เมื่อการใช้งานจริงต่างจากที่ตั้งไว้ ±10%' : 'เพิ่มอุปกรณ์เพื่อดูช่วงค่าไฟ'}</p></div><dl className="energy-facts"><div><dt>พลังงานต่อเดือน</dt><dd>{formatNumber(summary.monthlyKwh, 1)} <small>kWh</small></dd></div><div><dt>พลังงานต่อวัน</dt><dd>{formatNumber(summary.dailyKwh, 1)} <small>kWh</small></dd></div><div><dt>เครื่องใช้ไฟฟ้า</dt><dd>{summary.totalUnits} <small>เครื่อง</small></dd></div></dl></div>
      </section>

      <section className="overview-grid" id="monthly">
        <Card className="devices-card" id="devices"><header className="section-heading"><div><p className="kicker">สัดส่วนพลังงาน</p><h2>อุปกรณ์ที่ใช้ไฟสูงสุด</h2><span>เรียงตามพลังงานต่อเดือน</span></div><Button asChild variant="ghost"><Link href={myHomePath} aria-label="ดูอุปกรณ์ทั้งหมด">ทั้งหมด <ChevronRight aria-hidden="true" /></Link></Button></header><div className="device-list">{topDevices.length ? topDevices.map((device, index) => <div className="device-row" key={`${device.name}-${index}`}><div className="device-product-thumb"><Image src={device.image} alt="" width={72} height={72} /></div><div className="device-copy"><b>{device.name}</b><small>{device.detail}</small><span><i style={{width: `${device.width}%`}} /></span></div><div className="device-usage"><b>{device.energy}</b><small>{device.share}</small></div></div>) : <div className="device-empty"><i><Plus aria-hidden="true" /></i><div><b>ยังไม่มีเครื่องใช้ไฟฟ้า</b><span>เพิ่มอุปกรณ์ใน My Home แล้วข้อมูลจะปรากฏที่นี่</span></div><Button asChild variant="link"><Link href={myHomePath}>ไปที่ My Home <ChevronRight aria-hidden="true" /></Link></Button></div>}</div></Card>
        <Card className="bill-card">
          <header className="section-heading"><div><p className="kicker">บันทึกค่าไฟ</p><h2>ค่าไฟรายเดือน</h2><span>เปรียบเทียบค่าประมาณกับบิลจริงที่บันทึกไว้</span></div>{canEdit && <Button type="button" variant="ghost" disabled={billSaving} onClick={() => billFormOpen ? closeBillForm() : openBillForm()}>{billFormOpen ? 'ปิดฟอร์ม' : 'เพิ่มบิลจริง'} {billFormOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}</Button>}</header>

          {canEdit && billFormOpen && <form className="bill-form" onSubmit={saveBill}><div className="bill-form-header"><b>{billEditingMonth ? 'แก้ไขบิลจริง' : 'เพิ่มบิลจริง'}</b></div><label>เดือน<input type="month" value={billMonth} max={getBillingMonth()} onChange={(event) => setBillMonth(event.target.value)} disabled={Boolean(billEditingMonth)} required /></label><label>ยอดบิลจริง (บาท)<input type="number" min="0" step="0.01" value={actualBill} onChange={(event) => setActualBill(event.target.value)} placeholder="เช่น 512.50" required /></label><label>ใช้ไฟจริง (kWh) <small>ไม่บังคับ</small><input type="number" min="0" step="0.01" value={actualKwh} onChange={(event) => setActualKwh(event.target.value)} placeholder="เช่น 120" /></label>{billError && <p className="bill-form-error" role="alert">{billError}</p>}<div className="bill-form-actions"><Button type="button" variant="ghost" onClick={closeBillForm}>ยกเลิก</Button><Button type="submit" disabled={billSaving}>{billSaving ? 'กำลังบันทึก...' : 'บันทึกบิลจริง'}</Button></div></form>}
          <div className="bill-legend"><span><i className="estimate" />ค่าประมาณ</span><span><i className="actual" />บิลจริง</span></div>
          <div className="monthly-chart" aria-label="กราฟเปรียบเทียบค่าประมาณและบิลจริงรายเดือน">{monthlyBills.length ? monthlyBills.map((bill) => <div className="monthly-column" key={bill.billingMonth}><em>{bill.actualBill === null ? `ประมาณ ฿${formatNumber(bill.estimatedBill ?? 0)}` : `จริง ฿${formatNumber(bill.actualBill)}`}</em><div className="monthly-bars" role="img" aria-label={`${formatBillingMonthLabel(bill.billingMonth)}: ค่าประมาณ ${bill.estimatedBill === null ? 'ไม่มีข้อมูล' : formatNumber(bill.estimatedBill) + ' บาท'}, บิลจริง ${bill.actualBill === null ? 'ยังไม่บันทึก' : formatNumber(bill.actualBill) + ' บาท'}`}>{bill.estimatedBill !== null && <i className="estimate" style={{ height: `${(bill.estimatedBill / monthlyPeak) * 100}%` }} />}{bill.actualBill !== null && <i className="actual" style={{ height: `${(bill.actualBill / monthlyPeak) * 100}%` }} />}</div><small>{formatBillingMonthLabel(bill.billingMonth)}</small>{canEdit && <div className="monthly-record-actions"><Button type="button" variant="ghost" size="icon" aria-label={`แก้ไขบิล ${bill.billingMonth}`} onClick={() => openBillForm(bill)}><Pencil aria-hidden="true" /></Button>{bill.actualBill !== null && <Button type="button" variant="ghost" size="icon" aria-label={`ลบบิล ${bill.billingMonth}`} onClick={() => deleteBill(bill.billingMonth)}><Trash2 aria-hidden="true" /></Button>}</div>}</div>) : <div className="monthly-empty">ยังไม่มีข้อมูลรายเดือนที่บันทึกไว้</div>}</div>
          {billError && !billFormOpen && <p className="bill-form-error" role="alert">{billError}</p>}
        </Card>


      </section>

      {homeItems.length > 0 && <Card className="load-card" id="live-load"><header><div><p className="kicker">ช่วงเวลาการใช้ไฟ</p><h2>โหลดไฟภายในบ้าน</h2><span>ประมาณการจากช่วงเวลาที่ตั้งไว้ · วันทั่วไป</span></div></header><div className="load-summary"><span>โหลดติดตั้ง <b>{formatNumber(summary.ratedLoadKw, 2)} <small>kW</small></b></span><span>สูงสุดโดยประมาณ <b>{formatNumber(peak, 2)} <small>kW</small></b></span><span>โหลดเฉลี่ย <b>{formatNumber(averageLoad, 2)} <small>kW</small></b></span></div><div className="usage-line-chart" aria-label="กราฟประมาณการโหลดไฟตามช่วงเวลา">
        <svg viewBox="0 0 660 210" role="img" aria-label="โหลดไฟโดยประมาณ (kW)">
          {[0, 0.5, 1].map((fraction) => <line key={fraction} className="usage-grid" x1="28" x2="632" y1={170 - fraction * 140} y2={170 - fraction * 140} />)}
          <polyline className="usage-line" points={values.map((value, index) => `${28 + index * 604 / Math.max(values.length - 1, 1)},${170 - value / chartPeak * 140}`).join(' ')} />
          {values.map((value, index) => {
            const x = 28 + index * 604 / Math.max(values.length - 1, 1);
            const y = 170 - value / chartPeak * 140;
            const time = `${String(index * 2).padStart(2, '0')}:00`;
            return <g key={time}>
              <circle className="usage-point" cx={x} cy={y} r="4" tabIndex={0} aria-label={`${time}: ${value.toFixed(1)} kW`}><title>{`${time}: ${value.toFixed(1)} kW`}</title></circle>
              <text className="usage-value" x={x} y={y - 12} textAnchor="middle">{value.toFixed(1)}</text>
              <text className="usage-time" x={x} y="202" textAnchor="middle">{time}</text>
            </g>;
          })}
        </svg>
      </div></Card>}

      <section className="insight-card"><div><h3>ลองปรับเวลาใช้งาน แล้วเทียบค่าไฟอีกครั้ง</h3><p>ค่าประมาณอิงจากอุปกรณ์และรูปแบบการใช้งานที่คุณกำหนด</p></div><Button asChild variant="outline" className="insight-action"><Link href={myHomePath}>ปรับใน My Home <ArrowRight aria-hidden="true" /></Link></Button></section>
      </>}
    </main>
  </div>;
}
