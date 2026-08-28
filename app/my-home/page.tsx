'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Banknote, Gauge, House, Info, Plus, Search, Trash2, Zap } from 'lucide-react';
import { WattWiseSidebar } from '../components/WattWiseSidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberStepper } from '@/components/ui/number-stepper';
import { debounce } from '@/lib/debounce';
import { clearPendingHomeSave, readPendingHomeSave, stagePendingHomeSave } from '@/lib/home-save-outbox';
import { addOrIncrementHomeItem, applianceCatalog as catalog, calculateHomeSummary, createHomeItem, getHomeUsageSchedule, mergeHomeItems, type HomeAppliance } from '@/lib/home-config';
import { getUsageProfile } from '@/lib/usage-profiles';
import { scheduleHours, setAllDayUsageSchedule, toggleUsagePeriod, USAGE_PERIODS, updateUsagePeriodHours, type UsagePeriod } from '@/lib/usage-schedule';

const categories = ['ทั้งหมด', ...Array.from(new Set(catalog.map((item) => item.category)))];
const periodLabels: Record<UsagePeriod, { label: string; range: string }> = {
  morning: { label: 'เช้า', range: '06–12' },
  daytime: { label: 'กลางวัน', range: '12–18' },
  evening: { label: 'เย็น', range: '18–24' },
  night: { label: 'กลางคืน', range: '00–06' },
};

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value);
}

function getHomeSaveStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type HomeLockManager = { request(name: string, callback: () => Promise<void>): Promise<void> };

function withHomeSaveLock(task: () => Promise<void>): Promise<void> {
  const lockManager = (navigator as { locks?: HomeLockManager }).locks;
  if (!lockManager) return task();
  return lockManager.request('wattwise-home-save', () => task());
}

export default function MyHomePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ทั้งหมด');
  const [homeItems, setHomeItems] = useState<HomeAppliance[]>([]);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveSequence = useRef(0);
  const lastSavedBody = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const storage = getHomeSaveStorage();
    const pendingBody = storage ? readPendingHomeSave(storage) : null;

    if (pendingBody) {
      try {
        const pending = JSON.parse(pendingBody) as { items: HomeAppliance[] };
        void Promise.resolve().then(() => {
          if (cancelled) return;
          setHomeItems(mergeHomeItems(pending.items));
          setReady(true);
          setSaveState('saving');
        });
      } catch {
        if (storage) clearPendingHomeSave(storage, pendingBody);
      }
    } else {
      fetch('/api/home', { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error('load failed');
          return response.json() as Promise<{ items: HomeAppliance[] }>;
        })
        .then((data) => {
          if (cancelled) return;
          lastSavedBody.current = JSON.stringify({ items: data.items });
          setHomeItems(mergeHomeItems(data.items));
          setReady(true);
          setSaveState('saved');
        })
        .catch(() => { if (!cancelled) setSaveState('error'); });
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const sequence = ++saveSequence.current;
    const body = JSON.stringify({ items: homeItems });
    const storage = getHomeSaveStorage();
    if (storage) stagePendingHomeSave(storage, body);
    if (body === lastSavedBody.current) {
      setSaveState('saved');
      return;
    }
    const scheduleSave = debounce((snapshot: HomeAppliance[]) => {
      setSaveState('saving');
      saveQueue.current = saveQueue.current.catch(() => undefined).then(() => withHomeSaveLock(async () => {
        const savedBody = JSON.stringify({ items: snapshot });
        if (storage && readPendingHomeSave(storage) !== savedBody) return;
        const response = await fetch('/api/home', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: savedBody,
          keepalive: true,
        });
        if (!response.ok) throw new Error('save failed');
        lastSavedBody.current = savedBody;
        if (storage) clearPendingHomeSave(storage, savedBody);
        if (sequence === saveSequence.current) setSaveState('saved');
      })).catch(() => { if (sequence === saveSequence.current) setSaveState('error'); });
    }, 300);
    scheduleSave(homeItems);
    return scheduleSave.cancel;
  }, [homeItems, ready]);

  const filteredCatalog = useMemo(() => catalog.filter((item) => {
    const matchCategory = category === 'ทั้งหมด' || item.category === category;
    return matchCategory && `${item.brand} ${item.model} ${item.name} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [category, query]);

  const summary = calculateHomeSummary(homeItems);
  const itemEnergyById = new Map(summary.itemCalculations.map((item) => [
    item.instanceId,
    item.calculation.monthlyEnergyKwh,
  ]));

  function addToHome(id: string) {
    const appliance = catalog.find((item) => item.id === id);
    if (!appliance) return;
    setHomeItems((current) => addOrIncrementHomeItem(current, createHomeItem(appliance)));
  }

  function updateItem(instanceId: string, field: 'quantity' | 'cyclesPerMonth', value: number) {
    const maximum = field === 'cyclesPerMonth' ? 310 : undefined;
    const minimum = field === 'quantity' ? 1 : 0;
    setHomeItems((current) => current.map((item) => item.instanceId === instanceId
      ? { ...item, [field]: maximum === undefined
        ? Math.max(minimum, Number.isFinite(value) ? value : minimum)
        : Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)) }
      : item));
  }

  function updateSchedule(instanceId: string, period: UsagePeriod) {
    setHomeItems((current) => current.map((item) => {
      if (item.instanceId !== instanceId) return item;
      const profile = getUsageProfile(item.usageProfileId);
      const nextSchedule = toggleUsagePeriod(getHomeUsageSchedule(item), period, profile.step);
      return { ...item, usageSchedule: nextSchedule, hoursPerDay: profile.inputKind === 'hours' ? scheduleHours(nextSchedule) : item.hoursPerDay };
    }));
  }

  function updateScheduleHours(instanceId: string, period: UsagePeriod, value: number) {
    setHomeItems((current) => current.map((item) => {
      if (item.instanceId !== instanceId) return item;
      const profile = getUsageProfile(item.usageProfileId);
      const nextSchedule = updateUsagePeriodHours(getHomeUsageSchedule(item), period, value, profile.step);
      return { ...item, usageSchedule: nextSchedule, hoursPerDay: scheduleHours(nextSchedule) };
    }));
  }

  function setAllDay(instanceId: string) {
    setHomeItems((current) => current.map((item) => item.instanceId === instanceId
      ? { ...item, usageSchedule: setAllDayUsageSchedule(), hoursPerDay: 24 }
      : item));
  }

  return <main className="dashboard-shell my-home-shell">
    <WattWiseSidebar active="home" homeItemCount={saveState === 'loading' ? undefined : homeItems.length} />

    <section className="my-home-content">
      <header className="builder-header">
        <div><p className="kicker">MY HOME · ENERGY BUILDER</p><h1>ประกอบบ้านจำลองของคุณ</h1><span>เลือกเครื่องใช้ไฟฟ้า ปรับเวลาใช้งาน และดูค่าพลังงานโดยประมาณทันที</span></div>
        <div className="builder-header-actions"><span className={`save-pill ${saveState}`}><i />{saveState === 'loading' ? 'กำลังโหลด...' : saveState === 'saving' ? 'กำลังบันทึก...' : saveState === 'saved' ? 'บันทึกอัตโนมัติแล้ว' : 'บันทึกไม่สำเร็จ'}</span><Button asChild variant="outline" className="back-status"><Link href="/#overview"><ArrowLeft aria-hidden="true" /><span>กลับหน้า Status</span></Link></Button></div>
      </header>

      <section className="builder-summary" aria-label="สรุปบ้านจำลอง">
        <article><i><House aria-hidden="true" /></i><span><small>อุปกรณ์ในบ้าน</small><strong>{summary.totalUnits}</strong><em>เครื่อง</em></span></article>
        <article><i><Zap aria-hidden="true" /></i><span><small>พลังงานต่อเดือน</small><strong>{formatNumber(summary.monthlyKwh, 1)}</strong><em>kWh</em></span></article>
        <article className="bill"><i><Banknote aria-hidden="true" /></i><span><small>ค่าไฟโดยประมาณ</small><strong>{formatNumber(summary.monthlyBill)}</strong><em>บาท / เดือน</em></span></article>
        <article><i><Gauge aria-hidden="true" /></i><span><small>พลังงานเฉลี่ยต่อวัน</small><strong>{formatNumber(summary.dailyKwh, 1)}</strong><em>kWh</em></span></article>
      </section>
      <section className="builder-bill-breakdown" aria-label="รายละเอียดค่าไฟ"><p>{summary.bill.tariffLabel ?? 'บ้านอยู่อาศัยทั่วไป'}{summary.bill.tariffStatus === 'latest_known' ? ' · ใช้ข้อมูลล่าสุดที่ทราบ' : ''}</p>
        <span><small>ค่าไฟฐาน</small><b>{formatNumber(summary.bill.energyCharge, 2)} ฿</b></span>
        <span><small>ค่าบริการ</small><b>{formatNumber(summary.bill.serviceCharge, 2)} ฿</b></span>
        <span><small>Ft</small><b>{formatNumber(summary.bill.ftCharge, 2)} ฿</b></span>
        <span><small>VAT</small><b>{formatNumber(summary.bill.vat, 2)} ฿</b></span>
        <span className="builder-bill-total"><small>รวมโดยประมาณ</small><b>{formatNumber(summary.bill.total, 2)} ฿</b></span>
      </section>

      <section className="builder-workspace">
        <aside className="builder-catalog glass-panel">
          <header className="builder-panel-heading"><div><span>01</span><h2>เลือกเครื่องใช้ไฟฟ้า</h2></div><em>{filteredCatalog.length} รุ่น</em></header>
          <label className="builder-search"><i><Search aria-hidden="true" /></i><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหายี่ห้อ รุ่น หรือประเภท..." /></label>
          <div className="builder-tabs" aria-label="หมวดหมู่เครื่องใช้ไฟฟ้า">{categories.map((item) => <Button variant="ghost" className={category === item ? 'selected' : ''} onClick={() => setCategory(item)} key={item}>{item}</Button>)}</div>
          <div className="builder-catalog-list">{filteredCatalog.map((item) => <Card
            className="builder-appliance"
            key={item.id}
          >
            <div className="builder-product-image"><Image src={item.image} alt={`${item.brand} ${item.model}`} width={160} height={120} /></div>
            <div className="builder-product-copy"><span>{item.brand}</span><b>{item.name}</b><em>{item.detail}</em><small>{item.model}</small></div>
            <strong>{formatNumber(item.watts)}<small>W</small></strong>
            <Button variant="ghost" size="icon" onClick={() => addToHome(item.id)} aria-label={`เพิ่ม ${item.name}`}><Plus aria-hidden="true" /></Button>
          </Card>)}</div>
        </aside>

        <section className="builder-home glass-panel">
          <header className="builder-panel-heading"><div><span>02</span><h2>บ้านของฉัน</h2></div><em>{homeItems.length ? `${homeItems.length} รายการ` : 'กด + เพื่อเพิ่มอุปกรณ์'}</em></header>
          <div className={`builder-dropzone ${homeItems.length ? 'has-items' : ''}`}>
            {homeItems.length === 0 ? <div className="builder-empty"><i><Plus aria-hidden="true" /></i><h3>เริ่มสร้างบ้านพลังงานของคุณ</h3><p>กดเครื่องหมายบวกบนการ์ดเครื่องใช้ไฟฟ้า<br />เพื่อเพิ่มเข้าบ้านของคุณ</p><span>ข้อมูลจะคำนวณใหม่แบบทันที</span></div>
              : <div className="builder-home-list">{homeItems.map((item) => {
                const kwh = itemEnergyById.get(item.instanceId) ?? 0;
                const profile = getUsageProfile(item.usageProfileId);
                const schedule = getHomeUsageSchedule(item);
                return <Card className="builder-home-item" key={item.instanceId}>
                  <div className="builder-home-item-head"><div className="builder-home-image"><Image src={item.image} alt="" width={88} height={88} /></div><div className="builder-item-name"><span>{item.brand}</span><b>{item.name}</b><small>{item.model}</small><em>{profile.description}</em></div><Button variant="ghost" size="icon" onClick={() => setHomeItems((current) => current.filter((entry) => entry.instanceId !== item.instanceId))} aria-label={`ลบ ${item.name}`}><Trash2 aria-hidden="true" /></Button></div>
                  <div className="builder-home-item-controls"><NumberStepper label="จำนวน" unit="เครื่อง" value={item.quantity} min={1} step={1} onChange={(value) => updateItem(item.instanceId, 'quantity', value)} onEmpty={() => setHomeItems((current) => current.filter((entry) => entry.instanceId !== item.instanceId))} />{profile.inputKind === 'cycles' && <NumberStepper label="รอบ / เดือน" unit="รอบ" value={item.cyclesPerMonth ?? profile.defaultCyclesPerMonth ?? 0} min={profile.min} max={profile.max} step={profile.step} onChange={(value) => updateItem(item.instanceId, 'cyclesPerMonth', value)} onEmpty={() => updateItem(item.instanceId, 'cyclesPerMonth', 0)} />}{profile.inputKind === 'fixed' && <div className="builder-fixed-usage"><b>24 ชม. / วัน</b><span>คิดตาม duty cycle</span></div>}<div className="builder-item-energy"><b>{formatNumber(kwh, 1)}</b><span>kWh / เดือน</span></div></div>
                  <div className="builder-usage-schedule"><div className="builder-usage-schedule-header"><span>ช่วงที่ใช้งาน</span>{profile.inputKind === 'hours' && <><small>รวม {formatNumber(scheduleHours(schedule), 2)} ชม. / วัน</small><button type="button" onClick={() => setAllDay(item.instanceId)}>ตั้งเป็นทั้งวัน</button></>}{profile.inputKind === 'fixed' && <small>เปิดตลอดวัน</small>}{profile.inputKind === 'cycles' && <small>เลือกช่วงที่มักใช้งาน</small>}</div><div className="builder-period-chips">{USAGE_PERIODS.map((period) => {
                    const meta = periodLabels[period];
                    const selected = schedule.kind === 'all_day' || (schedule.kind === 'hours' ? schedule.hoursByPeriod[period] > 0 : schedule.periods.includes(period));
                    const locked = schedule.kind === 'all_day' || (schedule.kind === 'periods' && selected && schedule.periods.length === 1);
                    return <button type="button" className={`builder-period-chip ${selected ? 'selected' : ''}`} key={period} aria-pressed={selected} aria-label={`${meta.label} ${meta.range}`} disabled={locked} onClick={() => updateSchedule(item.instanceId, period)}>{meta.label}<small>{meta.range}</small></button>;
                  })}</div>{schedule.kind === 'hours' && <div className="builder-period-hours">{USAGE_PERIODS.filter((period) => schedule.hoursByPeriod[period] > 0).map((period) => <NumberStepper key={period} label={`${periodLabels[period].label} ${periodLabels[period].range}`} unit="ชม." value={schedule.hoursByPeriod[period]} min={profile.step} max={6} step={profile.step} onChange={(value) => updateScheduleHours(item.instanceId, period, value)} onEmpty={() => updateScheduleHours(item.instanceId, period, 0)} />)}</div>}</div>
                </Card>;
              })}</div>}
          </div>
          <footer className="builder-method"><i><Info aria-hidden="true" /></i><p><b>วิธีคำนวณประมาณการ</b><span>เลือกสูตรตามชนิดอุปกรณ์ ใช้ค่า profile มาตรฐาน และคิดค่าไฟตาม tariff บ้านอยู่อาศัยที่มีผลในเดือนนี้</span></p></footer>
        </section>
      </section>
    </section>
  </main>;
}
