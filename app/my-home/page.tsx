'use client';

import Image from 'next/image';
import Link from 'next/link';
import { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Banknote, Gauge, House, Info, Plus, Search, Trash2, Zap } from 'lucide-react';
import { WattWiseSidebar } from '../components/WattWiseSidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberStepper } from '@/components/ui/number-stepper';
import { debounce } from '@/lib/debounce';
import { addOrIncrementHomeItem, applianceCatalog as catalog, calculateHomeSummary, createHomeItem, mergeHomeItems, type HomeAppliance } from '@/lib/home-config';
import { getUsageProfile } from '@/lib/usage-profiles';

const categories = ['ทั้งหมด', ...Array.from(new Set(catalog.map((item) => item.category)))];

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value);
}

export default function MyHomePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ทั้งหมด');
  const [homeItems, setHomeItems] = useState<HomeAppliance[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/home', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('load failed');
        return response.json() as Promise<{ items: HomeAppliance[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setHomeItems(mergeHomeItems(data.items));
        setReady(true);
        setSaveState('saved');
      })
      .catch(() => { if (!cancelled) setSaveState('error'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const sequence = ++saveSequence.current;
    const scheduleSave = debounce((snapshot: HomeAppliance[]) => {
      setSaveState('saving');
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        const response = await fetch('/api/home', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: snapshot }),
        });
        if (!response.ok) throw new Error('save failed');
        if (sequence === saveSequence.current) setSaveState('saved');
      }).catch(() => { if (sequence === saveSequence.current) setSaveState('error'); });
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

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    addToHome(event.dataTransfer.getData('text/appliance-id'));
  }

  function updateItem(instanceId: string, field: 'quantity' | 'hoursPerDay' | 'cyclesPerMonth', value: number) {
    const maximum = field === 'hoursPerDay' ? 24 : field === 'cyclesPerMonth' ? 310 : undefined;
    const minimum = field === 'quantity' ? 1 : 0;
    setHomeItems((current) => current.map((item) => item.instanceId === instanceId
      ? { ...item, [field]: maximum === undefined
        ? Math.max(minimum, Number.isFinite(value) ? value : minimum)
        : Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)) }
      : item));
  }

  return <main className="dashboard-shell my-home-shell">
    <div className="meteor-field" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>
    <WattWiseSidebar active="home" />

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
            draggable
            key={item.id}
            onDragStart={(event) => { event.dataTransfer.setData('text/appliance-id', item.id); event.dataTransfer.effectAllowed = 'copy'; }}
          >
            <div className="builder-product-image"><Image src={item.image} alt={`${item.brand} ${item.model}`} width={160} height={120} /></div>
            <div className="builder-product-copy"><span>{item.brand}</span><b>{item.name}</b><em>{item.detail}</em><small>{item.model}</small></div>
            <strong>{formatNumber(item.watts)}<small>W</small></strong>
            <Button variant="ghost" size="icon" onClick={() => addToHome(item.id)} aria-label={`เพิ่ม ${item.name}`}><Plus aria-hidden="true" /></Button>
          </Card>)}</div>
        </aside>

        <section className="builder-home glass-panel">
          <header className="builder-panel-heading"><div><span>02</span><h2>บ้านของฉัน</h2></div><em>{homeItems.length ? `${homeItems.length} รายการ` : 'ลากอุปกรณ์มาวาง'}</em></header>
          <div
            className={`builder-dropzone ${dragActive ? 'drag-active' : ''} ${homeItems.length ? 'has-items' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); event.dataTransfer.dropEffect = 'copy'; }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            {homeItems.length === 0 ? <div className="builder-empty"><i><Plus aria-hidden="true" /></i><h3>เริ่มสร้างบ้านพลังงานของคุณ</h3><p>ลากเครื่องใช้ไฟฟ้าจากรายการด้านซ้ายมาวาง<br />หรือกดเครื่องหมายบวกบนการ์ด</p><span>ข้อมูลจะคำนวณใหม่แบบทันที</span></div>
              : <div className="builder-home-list">{homeItems.map((item) => {
                const kwh = itemEnergyById.get(item.instanceId) ?? 0;
                const profile = getUsageProfile(item.usageProfileId);
                return <Card className="builder-home-item" key={item.instanceId}>
                  <div className="builder-home-item-head"><div className="builder-home-image"><Image src={item.image} alt="" width={88} height={88} /></div><div className="builder-item-name"><span>{item.brand}</span><b>{item.name}</b><small>{item.model}</small><em>{profile.description}</em></div><Button variant="ghost" size="icon" onClick={() => setHomeItems((current) => current.filter((entry) => entry.instanceId !== item.instanceId))} aria-label={`ลบ ${item.name}`}><Trash2 aria-hidden="true" /></Button></div>
                  <div className="builder-home-item-controls"><NumberStepper label="จำนวน" unit="เครื่อง" value={item.quantity} min={1} step={1} onChange={(value) => updateItem(item.instanceId, 'quantity', value)} onEmpty={() => setHomeItems((current) => current.filter((entry) => entry.instanceId !== item.instanceId))} />{profile.inputKind === 'hours' && <NumberStepper label="ชม. / วัน" unit="ชม." value={item.hoursPerDay ?? profile.defaultHoursPerDay ?? 0} min={profile.min} max={profile.max} step={profile.step} onChange={(value) => updateItem(item.instanceId, 'hoursPerDay', value)} onEmpty={() => updateItem(item.instanceId, 'hoursPerDay', 0)} />}{profile.inputKind === 'cycles' && <NumberStepper label="รอบ / เดือน" unit="รอบ" value={item.cyclesPerMonth ?? profile.defaultCyclesPerMonth ?? 0} min={profile.min} max={profile.max} step={profile.step} onChange={(value) => updateItem(item.instanceId, 'cyclesPerMonth', value)} onEmpty={() => updateItem(item.instanceId, 'cyclesPerMonth', 0)} />}{profile.inputKind === 'fixed' && <div className="builder-fixed-usage"><b>24 ชม. / วัน</b><span>คิดตาม duty cycle</span></div>}<div className="builder-item-energy"><b>{formatNumber(kwh, 1)}</b><span>kWh / เดือน</span></div></div>
                </Card>;
              })}</div>}
          </div>
          <footer className="builder-method"><i><Info aria-hidden="true" /></i><p><b>วิธีคำนวณประมาณการ</b><span>เลือกสูตรตามชนิดอุปกรณ์ ใช้ค่า profile มาตรฐาน และคิดค่าไฟตาม tariff บ้านอยู่อาศัยที่มีผลในเดือนนี้</span></p></footer>
        </section>
      </section>
    </section>
  </main>;
}
