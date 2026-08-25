'use client';

import { DragEvent, useMemo, useState } from 'react';

type Appliance = {
  id: string;
  category: string;
  brand: string;
  model: string;
  name: string;
  watts: number;
  unit: string;
  icon: string;
  color: string;
};

type HomeAppliance = Appliance & {
  instanceId: string;
  quantity: number;
  hoursPerDay: number;
};

const catalog: Appliance[] = [
  { id: 'ac-daikin-18', category: 'เครื่องปรับอากาศ', brand: 'Daikin', model: 'FTKF18WV2S', name: 'Inverter 18,000 BTU', watts: 1540, unit: 'กำลังไฟพิกัด', icon: '❄', color: '#dff4ff' },
  { id: 'ac-mitsu-12', category: 'เครื่องปรับอากาศ', brand: 'Mitsubishi', model: 'MSY-KY13VF', name: 'Inverter 12,000 BTU', watts: 1020, unit: 'กำลังไฟพิกัด', icon: '❄', color: '#e8efff' },
  { id: 'fridge-samsung', category: 'ตู้เย็น', brand: 'Samsung', model: 'RT29K501JB1', name: 'ตู้เย็น 2 ประตู 300 ลิตร', watts: 110, unit: 'กำลังไฟโดยประมาณ', icon: '▣', color: '#e9f7ef' },
  { id: 'tv-lg-55', category: 'โทรทัศน์', brand: 'LG', model: '55UT8050', name: '4K Smart TV 55 นิ้ว', watts: 125, unit: 'ขณะใช้งาน', icon: '▰', color: '#f4eaff' },
  { id: 'washer-electrolux', category: 'เครื่องซักผ้า', brand: 'Electrolux', model: 'EWF9024D3WB', name: 'ฝาหน้า 9 กก.', watts: 500, unit: 'กำลังไฟพิกัด', icon: '◉', color: '#e7f7f5' },
  { id: 'fan-hatari', category: 'พัดลม', brand: 'Hatari', model: 'HT-S16M7', name: 'พัดลมตั้งพื้น 16 นิ้ว', watts: 49, unit: 'กำลังไฟพิกัด', icon: '✣', color: '#fff1da' },
];

const categories = ['ทั้งหมด', ...Array.from(new Set(catalog.map((item) => item.category)))];

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value);
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ทั้งหมด');
  const [homeItems, setHomeItems] = useState<HomeAppliance[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const filteredCatalog = useMemo(() => catalog.filter((item) => {
    const matchCategory = category === 'ทั้งหมด' || item.category === category;
    const haystack = `${item.brand} ${item.model} ${item.name}`.toLowerCase();
    return matchCategory && haystack.includes(query.trim().toLowerCase());
  }), [category, query]);

  const monthlyKwh = homeItems.reduce(
    (sum, item) => sum + (item.watts * item.quantity * item.hoursPerDay * 30) / 1000,
    0,
  );
  const estimatedBill = monthlyKwh * 4.18;

  function addToHome(id: string) {
    const appliance = catalog.find((item) => item.id === id);
    if (!appliance) return;
    setHomeItems((current) => [
      ...current,
      { ...appliance, instanceId: `${id}-${Date.now()}`, quantity: 1, hoursPerDay: appliance.category === 'ตู้เย็น' ? 24 : 4 },
    ]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    addToHome(event.dataTransfer.getData('text/appliance-id'));
  }

  function updateItem(instanceId: string, field: 'quantity' | 'hoursPerDay', value: number) {
    setHomeItems((current) => current.map((item) => item.instanceId === instanceId
      ? { ...item, [field]: Math.max(field === 'quantity' ? 1 : 0, Math.min(field === 'quantity' ? 20 : 24, value || 0)) }
      : item));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">W</div>
        <div>
          <p className="eyebrow">HOME ENERGY LAB</p>
          <h1>WattWise</h1>
        </div>
        <nav aria-label="เมนูหลัก">
          <button className="nav-active">สร้างบ้าน</button>
          <button>แดชบอร์ด</button>
          <button>จำลองสถานการณ์</button>
        </nav>
        <button className="outline-button">บันทึกบ้าน</button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow green">ENERGY BUILDER</p>
          <h2>ประกอบบ้านของคุณ<br />แล้วดูว่าพลังงานไปอยู่ที่ไหน</h2>
          <p className="hero-copy">เลือกเครื่องใช้ไฟฟ้าจากรุ่นจริง ลากเข้าบ้าน และปรับพฤติกรรมการใช้งานเพื่อดูค่าประมาณแบบทันที</p>
        </div>
        <div className="summary-grid">
          <div><span>อุปกรณ์ในบ้าน</span><strong>{homeItems.length}</strong><small>รายการ</small></div>
          <div><span>พลังงานต่อเดือน</span><strong>{formatNumber(monthlyKwh, 1)}</strong><small>kWh</small></div>
          <div className="accent"><span>ค่าไฟโดยประมาณ</span><strong>฿{formatNumber(estimatedBill)}</strong><small>ต่อเดือน</small></div>
        </div>
      </section>

      <section className="builder-grid">
        <aside className="catalog-panel">
          <div className="panel-heading">
            <div><p className="step">01</p><h3>เลือกเครื่องใช้ไฟฟ้า</h3></div>
            <span>{filteredCatalog.length} รุ่น</span>
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหายี่ห้อหรือรุ่น..." />
          </label>
          <div className="category-tabs" aria-label="หมวดหมู่">
            {categories.map((item) => <button key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <div className="catalog-list">
            {filteredCatalog.map((item) => (
              <article
                className="appliance-card"
                draggable
                key={item.id}
                onDragStart={(event) => event.dataTransfer.setData('text/appliance-id', item.id)}
              >
                <div className="device-icon" style={{ background: item.color }}>{item.icon}</div>
                <div className="device-copy"><span>{item.brand}</span><strong>{item.name}</strong><small>{item.model}</small></div>
                <div className="watt-badge"><strong>{formatNumber(item.watts)}</strong><span>W</span></div>
                <button onClick={() => addToHome(item.id)} aria-label={`เพิ่ม ${item.name}`}>＋</button>
              </article>
            ))}
          </div>
        </aside>

        <section className="home-panel">
          <div className="panel-heading">
            <div><p className="step">02</p><h3>บ้านของฉัน</h3></div>
            <span>ลากอุปกรณ์มาวาง</span>
          </div>
          <div
            className={`drop-zone ${dragActive ? 'drag-active' : ''} ${homeItems.length ? 'has-items' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            {homeItems.length === 0 ? (
              <div className="empty-state"><div>＋</div><h4>เริ่มสร้างบ้านพลังงานของคุณ</h4><p>ลากเครื่องใช้ไฟฟ้าจากรายการด้านซ้าย<br />หรือกดเครื่องหมายบวกบนการ์ด</p></div>
            ) : (
              <div className="home-list">
                {homeItems.map((item) => {
                  const kwh = (item.watts * item.quantity * item.hoursPerDay * 30) / 1000;
                  return <article className="home-item" key={item.instanceId}>
                    <div className="device-icon" style={{ background: item.color }}>{item.icon}</div>
                    <div className="home-item-title"><span>{item.brand} · {item.model}</span><strong>{item.name}</strong></div>
                    <label>จำนวน<input type="number" min="1" max="20" value={item.quantity} onChange={(e) => updateItem(item.instanceId, 'quantity', Number(e.target.value))} /></label>
                    <label>ชม./วัน<input type="number" min="0" max="24" step="0.5" value={item.hoursPerDay} onChange={(e) => updateItem(item.instanceId, 'hoursPerDay', Number(e.target.value))} /></label>
                    <div className="item-energy"><strong>{formatNumber(kwh, 1)}</strong><span>kWh/เดือน</span></div>
                    <button className="remove" onClick={() => setHomeItems((current) => current.filter((entry) => entry.instanceId !== item.instanceId))} aria-label={`ลบ ${item.name}`}>×</button>
                  </article>;
                })}
              </div>
            )}
          </div>
          <footer className="method-note"><strong>หมายเหตุเรื่องการคำนวณ</strong><p>ตัวอย่างแรกใช้กำลังไฟพิกัด × เวลาใช้งาน อัตราค่าไฟ ฿4.18/kWh เป็นค่าชั่วคราว ก่อนเชื่อมระบบอัตราค่าไฟแบบขั้นบันไดและข้อมูลฉลากพลังงาน</p></footer>
        </section>
      </section>
    </main>
  );
}
