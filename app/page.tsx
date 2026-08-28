'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Banknote, Bell, ChevronRight, Gauge, Pencil, Plus, Sparkles, Target, Trash2, X, Zap } from 'lucide-react';
import { WattWiseSidebar } from './components/WattWiseSidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { calculateHomeSummary, type HomeAppliance } from '@/lib/home-config';
import { formatBillingMonthLabel, getBillingMonth, selectRecentRecords, type MonthlyEnergyRecord } from '@/lib/monthly-history';

const chartData = {
  day: [1.4, 1.2, 1.1, 1.3, 1.9, 2.7, 3.4, 2.9, 2.4, 3.1, 3.7, 3.24],
  week: [2.1, 2.7, 2.45, 3.2, 3.6, 2.9, 3.24],
  month: [2.2, 2.55, 2.4, 2.8, 3.15, 2.95, 3.24],
};
type Period = keyof typeof chartData;

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value);
}

export default function Home() {
  const [period, setPeriod] = useState<Period>('day');
  const [homeItems, setHomeItems] = useState<HomeAppliance[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [history, setHistory] = useState<MonthlyEnergyRecord[]>([]);
  const [billFormOpen, setBillFormOpen] = useState(false);
  const [billMonth, setBillMonth] = useState(() => getBillingMonth());
  const [actualBill, setActualBill] = useState('');
  const [actualKwh, setActualKwh] = useState('');
  const [billEditingMonth, setBillEditingMonth] = useState<string | null>(null);
  const [billError, setBillError] = useState('');
  const [billSaving, setBillSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function refreshHome() {
      try {
        const response = await fetch('/api/home', { cache: 'no-store' });
        if (!response.ok) throw new Error('load failed');
         const data = await response.json() as { items: HomeAppliance[]; history?: MonthlyEnergyRecord[] };
         if (active) {
           setHomeItems(data.items);
           setHistory(data.history ?? []);
         }
      } finally {
        if (active) setHomeLoading(false);
      }
    }
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshHome(); };
    void refreshHome();
    window.addEventListener('focus', refreshHome);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshHome);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const summary = useMemo(() => calculateHomeSummary(homeItems), [homeItems]);
  const itemEnergyById = useMemo(() => new Map(summary.itemCalculations.map((item) => [
    item.instanceId,
    item.calculation.monthlyEnergyKwh,
  ])), [summary.itemCalculations]);
  const values = useMemo(() => {
    const scale = summary.ratedLoadKw > 0 ? summary.ratedLoadKw / 3.24 : 0;
    return chartData[period].map((value) => value * scale);
  }, [period, summary.ratedLoadKw]);
  const peak = Math.max(...values, 0);
  const chartPeak = Math.max(peak, 0.01);
  const averageLoad = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const budgetProgress = Math.min(100, (summary.monthlyBill / 3500) * 100);
  const metrics = [
    { icon: Zap, label: 'โหลดไฟรวม', note: 'เมื่ออุปกรณ์ทำงานพร้อมกัน', value: formatNumber(summary.ratedLoadKw, 2), unit: 'kW', trend: `${summary.totalUnits} เครื่อง`, compare: 'จาก My Home', tone: 'lime', bars: [2,3,2,5,4,7,6,8] },
    { icon: Gauge, label: 'พลังงานต่อวัน', note: 'จากชั่วโมงใช้งานที่กำหนด', value: formatNumber(summary.dailyKwh, 1), unit: 'kWh', trend: formatNumber(summary.monthlyKwh, 1), compare: 'kWh ต่อเดือน', tone: 'blue', bars: [2,4,3,6,5,8,6,7] },
    { icon: Banknote, label: 'ค่าไฟประมาณการ', note: summary.bill.tariffLabel ?? 'บ้านอยู่อาศัยทั่วไป', value: formatNumber(summary.monthlyBill), unit: 'บาท', trend: formatNumber(summary.monthlyKwh, 1), compare: 'หน่วยต่อเดือน', tone: 'amber', bars: [3,2,4,3,5,6,7,8] },
  ];
  const monthlyBills = useMemo(() => selectRecentRecords(history), [history]);
  const monthlyPeak = Math.max(...monthlyBills.flatMap((bill) => [bill.estimatedBill ?? 0, bill.actualBill ?? 0]), 1);
  const topDevices = [...homeItems].sort((a, b) => (itemEnergyById.get(b.instanceId) ?? 0) - (itemEnergyById.get(a.instanceId) ?? 0)).slice(0, 4).map((item, index) => {
    const monthlyKwh = itemEnergyById.get(item.instanceId) ?? 0;
    const share = summary.monthlyKwh > 0 ? monthlyKwh / summary.monthlyKwh * 100 : 0;
    return { image: item.image, name: item.name, detail: `${item.brand} · ${item.model} · ${item.quantity} เครื่อง`, energy: `${formatNumber(monthlyKwh, 1)} kWh`, share: `${formatNumber(share)}% ของทั้งเดือน`, width: share, tone: ['blue', 'amber', 'lime', 'violet'][index] };
  });

  function openBillForm(record?: MonthlyEnergyRecord) {
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

  async function saveBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBillSaving(true);
    setBillError('');
    try {
      const response = await fetch('/api/bills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: billMonth, actualBill, actualKwh }),
      });
      const data = await response.json() as { records?: MonthlyEnergyRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'บันทึกบิลจริงไม่สำเร็จ');
      setHistory(data.records ?? []);
      setBillFormOpen(false);
    } catch (error) {
      setBillError(error instanceof Error ? error.message : 'บันทึกบิลจริงไม่สำเร็จ');
    } finally {
      setBillSaving(false);
    }
  }

  async function deleteBill(month: string) {
    if (!window.confirm(`ลบบิลจริงของเดือน ${month} ใช่หรือไม่?`)) return;
    setBillError('');
    try {
      const response = await fetch(`/api/bills?month=${encodeURIComponent(month)}`, { method: 'DELETE' });
      const data = await response.json() as { records?: MonthlyEnergyRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'ลบบิลจริงไม่สำเร็จ');
      setHistory(data.records ?? []);
    } catch (error) {
      setBillError(error instanceof Error ? error.message : 'ลบบิลจริงไม่สำเร็จ');
    }
  }

  return <main className="dashboard-shell">
    <WattWiseSidebar active="status" homeItemCount={homeLoading ? undefined : homeItems.length} />

    <section className="dashboard-content" id="overview">
      <header className="dashboard-header">
        <div><p className="kicker">ภาพรวมพลังงาน</p><h1>สวัสดีคุณวิทวัส</h1><span>{homeLoading ? 'กำลังเชื่อมข้อมูล My Home...' : `อัปเดตจาก My Home · ${summary.totalUnits} เครื่อง`}</span></div>
        <div className="header-actions"><Button variant="ghost" size="icon" className="notify" aria-label="การแจ้งเตือน"><Bell aria-hidden="true" /><i /></Button><Button variant="ghost" className="profile"><i>WP</i><span><b>บ้านวิทวัส</b><small>เจ้าของบ้าน</small></span></Button></div>
      </header>

      <section className="system-banner"><div className="pulse"><i /></div><div><b>{homeLoading ? 'กำลังโหลดข้อมูลบ้าน' : homeItems.length ? 'เชื่อมข้อมูล My Home แล้ว' : 'เริ่มเพิ่มอุปกรณ์ใน My Home'}</b><p>{homeItems.length ? 'โหลด พลังงาน และค่าไฟคำนวณจากอุปกรณ์ที่บันทึกไว้' : 'ยังไม่มีอุปกรณ์ในบ้านจำลอง · ไปที่ My Home เพื่อเริ่มต้น'}</p></div><span><i /> SYNC</span></section>

      <section className="metric-grid" aria-label="ข้อมูลพลังงานสำคัญ">
        {metrics.map((item, index) => {
          const Icon = item.icon;
          return <Card className={`metric-card ${item.tone} ${index === 0 ? 'featured' : ''}`} key={item.label}>
          <div className="metric-title"><i><Icon aria-hidden="true" /></i><span><b>{item.label}</b><small>{item.note}</small></span></div>
          <div className="metric-value"><strong>{item.value}</strong><span>{item.unit}</span></div>
          <p className="trend">{item.trend} <span>{item.compare}</span></p>
          <div className="spark" aria-hidden="true">{item.bars.map((height, i) => <i key={i} style={{height: `${height * 9}%`}} />)}</div>
        </Card>;})}
        <Card className="metric-card violet forecast">
          <div className="metric-title"><i><Target aria-hidden="true" /></i><span><b>คาดการณ์สิ้นเดือน</b><small>จากรูปแบบการใช้งาน</small></span></div>
          <div className="metric-value"><strong>{formatNumber(summary.monthlyBill)}</strong><span>บาท</span></div>
          <div className="budget"><p><span>งบประมาณ 3,500 บาท</span><b>{formatNumber(budgetProgress)}%</b></p><i><span style={{ width: `${budgetProgress}%` }} /></i></div>
        </Card>
      </section>

      <Card className="load-card" id="live-load">
        <header><div><p className="kicker">LIVE MONITOR</p><h2>โหลดไฟภายในบ้าน</h2><span>กำลังไฟรวมจากอุปกรณ์ที่กำลังทำงาน</span></div><div className="period-switch">{(['day','week','month'] as Period[]).map(item => <Button variant="ghost" className={period === item ? 'active' : ''} onClick={() => setPeriod(item)} key={item}>{item === 'day' ? 'วันนี้' : item === 'week' ? '7 วัน' : '30 วัน'}</Button>)}</div></header>
        <div className="load-summary"><span>โหลดรวม <b>{formatNumber(summary.ratedLoadKw, 2)} <small>kW</small></b></span><span>สูงสุด <b>{formatNumber(peak, 2)} <small>kW</small></b></span><span>เฉลี่ย <b>{formatNumber(averageLoad, 2)} <small>kW</small></b></span></div>
        <div className="bar-chart" aria-label="กราฟโหลดไฟตามช่วงเวลา">{values.map((value, index) => <div className="bar-column" key={`${period}-${index}`}><em>{value.toFixed(1)}</em><i style={{height: `${(value / chartPeak) * 100}%`}} /><small>{period === 'day' ? `${String(index * 2).padStart(2,'0')}:00` : period === 'week' ? ['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'][index] : `W${index + 1}`}</small></div>)}</div>
      </Card>

      <section className="overview-grid" id="monthly">
        <Card className="bill-card">
          <header className="section-heading"><div><p className="kicker">MONTHLY BILL HISTORY</p><h2>ค่าไฟรายเดือน</h2><span>เปรียบเทียบค่าประมาณกับบิลจริงที่บันทึกไว้</span></div><Button variant="ghost" onClick={() => openBillForm()}>{billFormOpen ? 'ปิดฟอร์ม' : 'เพิ่มบิลจริง'} {billFormOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}</Button></header>
          <div className="bill-highlight"><span>ประมาณการเดือนนี้</span><strong>฿{formatNumber(summary.monthlyBill)}</strong><p><b>{formatNumber(summary.monthlyKwh, 1)} kWh</b> จาก My Home</p></div>
          {billFormOpen && <form className="bill-form" onSubmit={saveBill}>
            <div className="bill-form-header"><b>{billEditingMonth ? 'แก้ไขบิลจริง' : 'เพิ่มบิลจริง'}</b><Button type="button" variant="ghost" size="icon" aria-label="ปิดฟอร์ม" onClick={closeBillForm}><X aria-hidden="true" /></Button></div>
            <label>เดือน<input type="month" value={billMonth} max={getBillingMonth()} onChange={(event) => setBillMonth(event.target.value)} disabled={Boolean(billEditingMonth)} required /></label>
            <label>ยอดบิลจริง (บาท)<input type="number" min="0" step="0.01" value={actualBill} onChange={(event) => setActualBill(event.target.value)} placeholder="เช่น 512.50" required /></label>
            <label>ใช้ไฟจริง (kWh) <small>ไม่บังคับ</small><input type="number" min="0" step="0.01" value={actualKwh} onChange={(event) => setActualKwh(event.target.value)} placeholder="เช่น 120" /></label>
            {billError && <p className="bill-form-error" role="alert">{billError}</p>}
            <div className="bill-form-actions"><Button type="button" variant="ghost" onClick={closeBillForm}>ยกเลิก</Button><Button type="submit" disabled={billSaving}>{billSaving ? 'กำลังบันทึก...' : 'บันทึกบิลจริง'}</Button></div>
          </form>}
          <div className="bill-legend"><span><i className="estimate" />ค่าประมาณ</span><span><i className="actual" />บิลจริง</span></div>
          <div className="monthly-chart" aria-label="กราฟเปรียบเทียบค่าประมาณและบิลจริงรายเดือน">
            {monthlyBills.length ? monthlyBills.map((bill) => <div className="monthly-column" key={bill.billingMonth}>
              <em>{bill.actualBill === null ? `ประมาณ ฿${formatNumber(bill.estimatedBill ?? 0)}` : `จริง ฿${formatNumber(bill.actualBill)}`}</em>
              <div className="monthly-bars">{bill.estimatedBill !== null && <i className="estimate" style={{ height: `${(bill.estimatedBill / monthlyPeak) * 100}%` }} />}{bill.actualBill !== null && <i className="actual" style={{ height: `${(bill.actualBill / monthlyPeak) * 100}%` }} />}</div>
              <small>{formatBillingMonthLabel(bill.billingMonth)}</small>
              <div className="monthly-record-actions"><Button type="button" variant="ghost" size="icon" aria-label={`แก้ไขบิล ${bill.billingMonth}`} onClick={() => openBillForm(bill)}><Pencil aria-hidden="true" /></Button>{bill.actualBill !== null && <Button type="button" variant="ghost" size="icon" aria-label={`ลบบิล ${bill.billingMonth}`} onClick={() => deleteBill(bill.billingMonth)}><Trash2 aria-hidden="true" /></Button>}</div>
            </div>) : <div className="monthly-empty">ยังไม่มีข้อมูลรายเดือนที่บันทึกไว้</div>}
          </div>
          {billError && !billFormOpen && <p className="bill-form-error" role="alert">{billError}</p>}
        </Card>

        <Card className="devices-card" id="devices">
          <header className="section-heading"><div><p className="kicker">TOP CONSUMPTION</p><h2>อุปกรณ์ที่ใช้ไฟสูงสุด</h2><span>เรียงตามพลังงานต่อเดือน</span></div><Button variant="ghost" aria-label="ดูอุปกรณ์ทั้งหมด">ทั้งหมด <ChevronRight aria-hidden="true" /></Button></header>
          <div className="device-list">{topDevices.length ? topDevices.map((device, index) => <div className={`device-row ${device.tone}`} key={`${device.name}-${index}`}>
            <div className="device-product-thumb"><Image src={device.image} alt="" width={72} height={72} /></div><div className="device-copy"><b>{device.name}</b><small>{device.detail}</small><span><i style={{width: `${device.width}%`}} /></span></div><div className="device-usage"><b>{device.energy}</b><small>{device.share}</small></div>
          </div>) : <div className="device-empty"><i><Plus aria-hidden="true" /></i><div><b>ยังไม่มีเครื่องใช้ไฟฟ้า</b><span>เพิ่มอุปกรณ์ใน My Home แล้วข้อมูลจะปรากฏที่นี่</span></div><Button asChild variant="link"><a href="/my-home">ไปที่ My Home <ChevronRight aria-hidden="true" /></a></Button></div>}</div>
        </Card>
      </section>

      <section className="insight-card" id="settings">
        <div className="insight-icon"><Sparkles aria-hidden="true" /></div><div><p className="kicker">WATTWISE INSIGHT</p><h3>ปรับชั่วโมงใช้งานเพื่อดูผลประหยัดทันที</h3><span>ลดการใช้พลังงาน 10% อาจช่วยประหยัดประมาณ <b>฿{formatNumber(summary.monthlyBill * 0.1)} ต่อเดือน</b></span></div><Button asChild variant="outline" className="insight-action"><a href="/my-home">ปรับใน My Home <ArrowRight aria-hidden="true" /></a></Button>
      </section>
    </section>
  </main>;
}
