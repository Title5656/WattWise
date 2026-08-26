'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Banknote, Bell, ChevronRight, ExternalLink, Gauge, Plus, Sparkles, Target, Zap } from 'lucide-react';
import { WattWiseSidebar } from './components/WattWiseSidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { calculateHomeSummary, type HomeAppliance } from '@/lib/home-config';

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

  useEffect(() => {
    let active = true;
    async function refreshHome() {
      try {
        const response = await fetch('/api/home', { cache: 'no-store' });
        if (!response.ok) throw new Error('load failed');
        const data = await response.json() as { items: HomeAppliance[] };
        if (active) setHomeItems(data.items);
      } finally {
        if (active) setHomeLoading(false);
      }
    }
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshHome(); };
    void refreshHome();
    const interval = window.setInterval(refreshHome, 15000);
    window.addEventListener('focus', refreshHome);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshHome);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const summary = useMemo(() => calculateHomeSummary(homeItems), [homeItems]);
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
    { icon: Banknote, label: 'ค่าไฟประมาณการ', note: 'อัตราเฉลี่ย 4.18 บาท/kWh', value: formatNumber(summary.monthlyBill), unit: 'บาท', trend: formatNumber(summary.monthlyKwh, 1), compare: 'หน่วยต่อเดือน', tone: 'amber', bars: [3,2,4,3,5,6,7,8] },
  ];
  const monthlyBills = [0.82, 0.91, 1.08, 0.99, 0.94, 1].map((ratio, index) => ({ month: ['มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.'][index], value: summary.monthlyBill * ratio }));
  const monthlyPeak = Math.max(...monthlyBills.map((bill) => bill.value), 1);
  const topDevices = [...homeItems].sort((a, b) => b.watts * b.quantity - a.watts * a.quantity).slice(0, 4).map((item, index) => {
    const watts = item.watts * item.quantity;
    const share = summary.ratedLoadKw > 0 ? watts / (summary.ratedLoadKw * 1000) * 100 : 0;
    return { image: item.image, name: item.name, detail: `${item.brand} · ${item.model} · ${item.quantity} เครื่อง`, watts: `${formatNumber(watts / 1000, 2)} kW`, share: `${formatNumber(share)}% ของทั้งหมด`, width: share, tone: ['blue', 'amber', 'lime', 'violet'][index] };
  });

  return <main className="dashboard-shell">
    <div className="meteor-field" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
    </div>
    <WattWiseSidebar active="status" />

    <section className="dashboard-content" id="overview">
      <header className="dashboard-header">
        <div><p className="kicker">ภาพรวมพลังงาน</p><h1>สวัสดีตอนเย็น, วรปรัชญ์</h1><span>{homeLoading ? 'กำลังเชื่อมข้อมูล My Home...' : `อัปเดตจาก My Home · ${summary.totalUnits} เครื่อง`}</span></div>
        <div className="header-actions"><Button variant="ghost" size="icon" className="notify" aria-label="การแจ้งเตือน"><Bell aria-hidden="true" /><i /></Button><Button variant="ghost" className="profile"><i>WP</i><span><b>บ้านวรปรัชญ์</b><small>เจ้าของบ้าน</small></span></Button></div>
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
          <header className="section-heading"><div><p className="kicker">6 MONTH OVERVIEW</p><h2>ค่าไฟย้อนหลัง</h2><span>แนวโน้มค่าใช้จ่ายรายเดือนของบ้าน</span></div><Button variant="ghost">ดูรายละเอียด <ExternalLink aria-hidden="true" /></Button></header>
          <div className="bill-highlight"><span>ประมาณการเดือนนี้</span><strong>฿{formatNumber(summary.monthlyBill)}</strong><p><b>{formatNumber(summary.monthlyKwh, 1)} kWh</b> จาก My Home</p></div>
          <div className="monthly-chart" aria-label="ค่าไฟย้อนหลังหกเดือน">
            {monthlyBills.map((bill) => <div key={bill.month}><em>฿{formatNumber(bill.value)}</em><i style={{height: `${(bill.value / monthlyPeak) * 100}%`}} className={bill.month === 'ส.ค.' ? 'current' : ''} /><small>{bill.month}</small></div>)}
          </div>
        </Card>

        <Card className="devices-card" id="devices">
          <header className="section-heading"><div><p className="kicker">TOP CONSUMPTION</p><h2>อุปกรณ์ที่ใช้ไฟสูงสุด</h2><span>เรียงตามโหลดปัจจุบัน</span></div><Button variant="ghost" aria-label="ดูอุปกรณ์ทั้งหมด">ทั้งหมด <ChevronRight aria-hidden="true" /></Button></header>
          <div className="device-list">{topDevices.length ? topDevices.map((device, index) => <div className={`device-row ${device.tone}`} key={`${device.name}-${index}`}>
            <div className="device-product-thumb"><Image src={device.image} alt="" width={72} height={72} /></div><div className="device-copy"><b>{device.name}</b><small>{device.detail}</small><span><i style={{width: `${device.width}%`}} /></span></div><div className="device-usage"><b>{device.watts}</b><small>{device.share}</small></div>
          </div>) : <div className="device-empty"><i><Plus aria-hidden="true" /></i><div><b>ยังไม่มีเครื่องใช้ไฟฟ้า</b><span>เพิ่มอุปกรณ์ใน My Home แล้วข้อมูลจะปรากฏที่นี่</span></div><Button asChild variant="link"><a href="/my-home">ไปที่ My Home <ChevronRight aria-hidden="true" /></a></Button></div>}</div>
        </Card>
      </section>

      <section className="insight-card" id="settings">
        <div className="insight-icon"><Sparkles aria-hidden="true" /></div><div><p className="kicker">WATTWISE INSIGHT</p><h3>ปรับชั่วโมงใช้งานเพื่อดูผลประหยัดทันที</h3><span>ลดการใช้พลังงาน 10% อาจช่วยประหยัดประมาณ <b>฿{formatNumber(summary.monthlyBill * 0.1)} ต่อเดือน</b></span></div><Button asChild variant="outline" className="insight-action"><a href="/my-home">ปรับใน My Home <ArrowRight aria-hidden="true" /></a></Button>
      </section>
    </section>
  </main>;
}
