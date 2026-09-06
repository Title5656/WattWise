'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Info, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberStepper } from '@/components/ui/number-stepper';
import { buildCatalogUrl, catalogReducer, formatCatalogEnergySpec, initialCatalogState, isCatalogQueryReady } from '@/lib/catalog-ui';
import type { CatalogResponse } from '@/lib/catalog-repository';
import { debounce } from '@/lib/debounce';
import { addOrIncrementHomeItem, calculateHomeSummary, createHomeItem, getHomeUsageSchedule, type Appliance, type HomeAppliance } from '@/lib/home-config';
import {
  createScopedResourceSlot,
  householdContentScopeKey,
} from '@/lib/household-client-lifecycle';
import {
  canEditHousehold,
  homeAutosaveStorageForRole,
  householdDashboardPath,
  type CurrentUser,
  type HouseholdMembership,
} from '@/lib/household-ui';
import { createLatestRequestTracker, isAbortError } from '@/lib/latest-request';
import {
  createScopedHomeAutosaveController,
  type ScopedHomeAutosaveController,
  type ScopedHomeAutosaveState,
} from '@/lib/scoped-home-autosave';
import { getUsageProfile } from '@/lib/usage-profiles';
import { scheduleHours, setAllDayUsageSchedule, toggleUsagePeriod, USAGE_PERIODS, updateUsagePeriodHours, type UsagePeriod } from '@/lib/usage-schedule';
import { HouseholdAccessState } from './HouseholdAccessState';
import { HouseholdIdentityBar } from './HouseholdIdentityBar';
import { WattWiseSidebar } from './WattWiseSidebar';
import { useHouseholdContext } from './use-household-memberships';

const periodLabels: Record<UsagePeriod, { label: string; range: string }> = {
  morning: { label: 'เช้า', range: '06–12' },
  daytime: { label: 'กลางวัน', range: '12–18' },
  evening: { label: 'เย็น', range: '18–24' },
  night: { label: 'กลางคืน', range: '00–06' },
};

const initialAutosaveState: ScopedHomeAutosaveState = {
  phase: 'idle',
  editable: false,
  scope: null,
  generation: 0,
  revision: null,
  items: [],
  currentRevision: null,
};

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value);
}

export function HouseholdMyHome({ householdId }: { householdId: string }) {
  const context = useHouseholdContext(householdId);
  if (context.phase !== 'ready') {
    return <HouseholdAccessState
      phase={context.phase}
      error={context.error}
      onRefresh={() => void context.refresh()}
    />;
  }
  if (!context.user || !context.household) return <HouseholdAccessState phase="error" />;
  return <HouseholdMyHomeContent
    key={householdContentScopeKey(context.user, context.household)}
    householdId={householdId}
    user={context.user}
    household={context.household}
    households={context.households}
    onRefreshMemberships={context.refresh}
  />;
}

function HouseholdMyHomeContent({
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
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [catalogState, dispatchCatalog] = useReducer(catalogReducer, initialCatalogState);
  const [autosaveState, setAutosaveState] = useState(initialAutosaveState);
  const [storageError, setStorageError] = useState('');
  const autosaveController = useRef<ScopedHomeAutosaveController | null>(null);
  const [autosaveResources] = useState(() => createScopedResourceSlot<{
    controller: ScopedHomeAutosaveController;
    dispose(): void;
  }>());
  const catalogRequests = useRef(createLatestRequestTracker());
  const readOnly = !canEditHousehold(household.role);
  const autosaveScopeKey = householdContentScopeKey(user, household);
  const autosaveRole = household.role;
  const autosaveUserId = user.id;
  const homeItems = autosaveState.items;
  const canMutate = !readOnly && autosaveState.editable;

  const loadCatalog = useCallback(async (page: number, append: boolean) => {
    const request = catalogRequests.current.begin();
    dispatchCatalog({ type: 'request', append });
    try {
      const response = await fetch(buildCatalogUrl({ q: debouncedQuery, category, page }), {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('catalog load failed');
      const data = await response.json() as CatalogResponse;
      if (!catalogRequests.current.isLatest(request.generation)) return;
      dispatchCatalog({ type: 'success', response: data, append });
    } catch (error) {
      if (isAbortError(error) || !catalogRequests.current.isLatest(request.generation)) return;
      dispatchCatalog({
        type: 'failure',
        append,
        message: append ? 'โหลดรายการเพิ่มเติมไม่สำเร็จ' : 'ไม่สามารถโหลดรายการเครื่องใช้ไฟฟ้าได้',
      });
    }
  }, [category, debouncedQuery]);

  useEffect(() => {
    catalogRequests.current.cancel();
    dispatchCatalog({ type: 'reset' });
    const updateQuery = debounce((value: string) => setDebouncedQuery(value.trim()), 300);
    updateQuery(query);
    return updateQuery.cancel;
  }, [query]);

  useEffect(() => {
    const requests = catalogRequests.current;
    dispatchCatalog({ type: 'reset' });
    if (!isCatalogQueryReady(query, debouncedQuery)) {
      requests.cancel();
      return;
    }
    void loadCatalog(1, false);
    return () => requests.cancel();
  }, [debouncedQuery, loadCatalog, query]);

  useEffect(() => {
    let cancelled = false;
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      void Promise.resolve().then(() => {
        if (!cancelled) setStorageError('เบราว์เซอร์ไม่อนุญาตให้เก็บฉบับร่าง จึงไม่สามารถแก้ไข My Home ได้');
      });
      return () => { cancelled = true; };
    }
    const browserLocks = (navigator as Navigator & {
      locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
    }).locks;
    const resource = autosaveResources.replace(autosaveScopeKey, () => {
      const controller = createScopedHomeAutosaveController({
        storage: homeAutosaveStorageForRole(storage, autosaveRole),
        fetch,
        locks: browserLocks,
        debounceMs: 300,
      });
      const unsubscribe = controller.subscribe(setAutosaveState);
      return {
        controller,
        dispose() {
          unsubscribe();
          controller.dispose();
        },
      };
    });
    const { controller } = resource;
    autosaveController.current = controller;
    void controller.activate({ userId: autosaveUserId, householdId });

    return () => {
      cancelled = true;
      autosaveResources.clear(autosaveScopeKey);
      if (autosaveController.current === controller) autosaveController.current = null;
    };
  }, [autosaveResources, autosaveRole, autosaveScopeKey, autosaveUserId, householdId]);

  const [mobilePanel, setMobilePanel] = useState<'home' | 'catalog'>('home');
  const summary = calculateHomeSummary(homeItems);
  const itemEnergyById = new Map(summary.itemCalculations.map((item) => [
    item.instanceId,
    item.calculation.monthlyEnergyKwh,
  ]));

  function editItems(update: (current: HomeAppliance[]) => HomeAppliance[]) {
    if (!canMutate) return;
    autosaveController.current?.edit(update(homeItems));
  }

  function addToHome(appliance: Appliance) {
    editItems((current) => addOrIncrementHomeItem(current, createHomeItem(appliance)));
  }

  function updateItem(instanceId: string, field: 'quantity' | 'cyclesPerMonth', value: number) {
    editItems((current) => current.map((item) => item.instanceId === instanceId
      ? { ...item, [field]: field === 'quantity'
        ? Math.min(99, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)))
        : Math.max(0, Math.min(310, Number.isFinite(value) ? value : 0)) }
      : item));
  }

  function updateSchedule(instanceId: string, period: UsagePeriod) {
    editItems((current) => current.map((item) => {
      if (item.instanceId !== instanceId) return item;
      const profile = getUsageProfile(item.usageProfileId);
      const nextSchedule = toggleUsagePeriod(getHomeUsageSchedule(item), period, profile.step);
      return { ...item, usageSchedule: nextSchedule, hoursPerDay: profile.inputKind === 'hours' ? scheduleHours(nextSchedule) : item.hoursPerDay };
    }));
  }

  function updateScheduleHours(instanceId: string, period: UsagePeriod, value: number) {
    editItems((current) => current.map((item) => {
      if (item.instanceId !== instanceId) return item;
      const profile = getUsageProfile(item.usageProfileId);
      const nextSchedule = updateUsagePeriodHours(getHomeUsageSchedule(item), period, value, profile.step);
      return { ...item, usageSchedule: nextSchedule, hoursPerDay: scheduleHours(nextSchedule) };
    }));
  }

  function setAllDay(instanceId: string) {
    editItems((current) => current.map((item) => item.instanceId === instanceId
      ? { ...item, usageSchedule: setAllDayUsageSchedule(), hoursPerDay: 24 }
      : item));
  }

  function retryAutosave() {
    const controller = autosaveController.current;
    if (controller) controller.retry();
  }

  function discardConflictDraft() {
    const controller = autosaveController.current;
    if (controller) void controller.discardDraftAndReload();
  }

  if (autosaveState.phase === 'session-expired') {
    return <HouseholdAccessState phase="session-expired" onRefresh={() => void onRefreshMemberships()} />;
  }
  if (autosaveState.phase === 'access-denied') {
    return <HouseholdAccessState phase="access-denied" onRefresh={() => void onRefreshMemberships()} />;
  }

  const homeLoading = autosaveState.phase === 'idle' || autosaveState.phase === 'loading';
  const saveLabel = autosaveState.phase === 'idle' || autosaveState.phase === 'loading'
    ? 'กำลังโหลด...'
    : autosaveState.phase === 'ready' || autosaveState.phase === 'saving'
      ? 'กำลังบันทึก...'
      : autosaveState.phase === 'saved'
        ? 'บันทึกอัตโนมัติแล้ว'
        : autosaveState.phase === 'conflict'
          ? 'พบข้อมูลเวอร์ชันใหม่'
          : 'บันทึกไม่สำเร็จ';

  return <div className="dashboard-shell my-home-shell">
    <WattWiseSidebar active="home" householdId={householdId} homeItemCount={autosaveState.phase === 'loading' ? undefined : homeItems.length} />
    <main className="my-home-content" id="page-content" tabIndex={-1}>
      <header className="builder-header">
        <div><p className="kicker">MY HOME · {household.name}</p><h1>เครื่องใช้ไฟฟ้าในบ้าน</h1><span>ปรับจำนวนและเวลาใช้งาน เพื่อให้ค่าประมาณใกล้เคียงบ้านของคุณ</span></div>
        <div className="builder-header-actions"><span role="status" aria-live="polite" className={`save-pill ${autosaveState.phase}`}><i />{saveLabel}</span><Button asChild variant="outline" className="back-status"><Link href={`${householdDashboardPath(householdId)}#overview`}><ArrowLeft aria-hidden="true" /><span>ดูภาพรวม</span></Link></Button></div>
      </header>
      <div className="builder-identity"><HouseholdIdentityBar user={user} household={household} households={households} destination="my-home" /></div>

      {readOnly && <section className="read-only-banner" role="status"><b>คุณมีสิทธิ์ดูข้อมูลเท่านั้น</b><span>บทบาทผู้ชมไม่สามารถเพิ่ม ลบ หรือปรับการใช้งานเครื่องใช้ไฟฟ้าได้</span></section>}
      {storageError && <section className="autosave-message error" role="alert"><b>ไม่สามารถเปิดระบบบันทึกฉบับร่าง</b><span>{storageError}</span></section>}
      {autosaveState.phase === 'conflict' && <section className="autosave-message conflict" role="alert"><div><b>My Home มีข้อมูลเวอร์ชันใหม่กว่า</b><span>ฉบับร่างของคุณยังอยู่ครบ ระบบจะไม่รวมข้อมูลหรือบันทึกซ้ำอัตโนมัติ{autosaveState.currentRevision === null ? '' : ` · เวอร์ชันล่าสุด ${autosaveState.currentRevision}`}</span></div><Button variant="outline" onClick={discardConflictDraft}>ละทิ้งฉบับร่างและโหลดใหม่</Button></section>}
      {autosaveState.phase === 'retryable-error' && <section className="autosave-message error" role="alert"><div><b>บันทึกไม่สำเร็จชั่วคราว</b><span>ฉบับร่างยังอยู่ในอุปกรณ์นี้ กรุณาลองใหม่เมื่อการเชื่อมต่อพร้อม</span></div><Button variant="outline" onClick={retryAutosave}>ลองบันทึกอีกครั้ง</Button></section>}

      <section className="builder-summary" aria-label="สรุปบ้านจำลอง" aria-busy={homeLoading}>
        <article><span><small>อุปกรณ์ในบ้าน</small><strong>{homeLoading ? '—' : summary.totalUnits}</strong><em>เครื่อง</em></span></article><article><span><small>พลังงานต่อเดือน</small><strong>{homeLoading ? '—' : formatNumber(summary.monthlyKwh, 1)}</strong><em>kWh</em></span></article><article className="bill"><span><small>ค่าไฟโดยประมาณ</small><strong>{homeLoading ? '—' : formatNumber(summary.monthlyBill)}</strong><em>บาท / เดือน</em></span></article><article><span><small>พลังงานเฉลี่ยต่อวัน</small><strong>{homeLoading ? '—' : formatNumber(summary.dailyKwh, 1)}</strong><em>kWh</em></span></article>
      </section>
      <details className="bill-disclosure" hidden={homeLoading}><summary>รายละเอียดการคำนวณค่าไฟ</summary><section className="builder-bill-breakdown" aria-label="รายละเอียดค่าไฟ"><p>{summary.bill.tariffLabel ?? 'บ้านอยู่อาศัยทั่วไป'}{summary.bill.tariffStatus === 'latest_known' ? ' · ใช้ข้อมูลล่าสุดที่ทราบ' : ''}</p><span><small>ค่าไฟฐาน</small><b>{formatNumber(summary.bill.energyCharge, 2)} ฿</b></span><span><small>ค่าบริการ</small><b>{formatNumber(summary.bill.serviceCharge, 2)} ฿</b></span><span><small>Ft</small><b>{formatNumber(summary.bill.ftCharge, 2)} ฿</b></span><span><small>VAT</small><b>{formatNumber(summary.bill.vat, 2)} ฿</b></span><span className="builder-bill-total"><small>รวมโดยประมาณ</small><b>{formatNumber(summary.bill.total, 2)} ฿</b></span></section></details>

<div className="builder-mobile-nav" aria-label="มุมมองเครื่องใช้ไฟฟ้า"><button type="button" aria-pressed={mobilePanel === 'home'} onClick={() => setMobilePanel('home')}>ในบ้าน ({homeItems.length})</button><button type="button" aria-pressed={mobilePanel === 'catalog'} onClick={() => setMobilePanel('catalog')}>เพิ่มจากแคตตาล็อก</button></div>
      <section className={`builder-workspace show-${mobilePanel}`}>
        <aside className="builder-catalog builder-panel" aria-label="แคตตาล็อกเครื่องใช้ไฟฟ้า">
          <header className="builder-panel-heading"><div><h2>เลือกเครื่องใช้ไฟฟ้า</h2></div><em>{catalogState.loading ? 'กำลังโหลด' : `${catalogState.pagination.total} รุ่น`}</em></header>
          <label className="builder-search"><i><Search aria-hidden="true" /></i><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหายี่ห้อ รุ่น หรือประเภท..." aria-label="ค้นหาเครื่องใช้ไฟฟ้า" /></label>
          <div className="builder-tabs" aria-label="หมวดหมู่เครื่องใช้ไฟฟ้า"><Button variant="ghost" aria-pressed={category === null} className={category === null ? 'selected' : ''} onClick={() => setCategory(null)}>ทั้งหมด</Button>{catalogState.categories.map((item) => <Button variant="ghost" aria-pressed={category === item.slug} className={category === item.slug ? 'selected' : ''} onClick={() => setCategory(item.slug)} key={item.slug}>{item.name}</Button>)}</div>
          {catalogState.loading && <div className="builder-catalog-state" role="status" aria-live="polite"><span className="catalog-spinner" aria-hidden="true" />กำลังโหลดรายการเครื่องใช้ไฟฟ้า...</div>}
          {!catalogState.loading && catalogState.error && <div className="builder-catalog-state error" role="alert"><b>โหลดแคตตาล็อกไม่สำเร็จ</b><span>{catalogState.error}</span><Button variant="outline" onClick={() => void loadCatalog(1, false)}>ลองอีกครั้ง</Button></div>}
          {!catalogState.loading && !catalogState.error && catalogState.items.length === 0 && <div className="builder-catalog-state" role="status"><b>ไม่พบเครื่องใช้ไฟฟ้า</b><span>ลองคำค้นหาอื่น หรือเลือกหมวดทั้งหมด</span></div>}
          {!catalogState.loading && !catalogState.error && catalogState.items.length > 0 && <><div className="builder-catalog-list">{catalogState.items.map((item) => { const energy = item.energySpec ? formatCatalogEnergySpec(item.energySpec) : null; return <Card className="builder-appliance" key={item.id}><div className="builder-product-image"><Image src={item.image} alt={`${item.brand} ${item.model}`} width={160} height={120} /></div><div className="builder-product-copy"><span>{item.brand}</span><b>{item.name}</b><em>{item.detail}</em><small>{item.model}</small></div><strong>{energy?.value ?? '—'}<small>{energy?.unit ?? 'ไม่มีข้อมูล'}</small></strong><Button variant="ghost" size="icon" disabled={readOnly || !canMutate} onClick={() => addToHome(item)} aria-label={`เพิ่ม ${item.name}`}><Plus aria-hidden="true" /></Button></Card>; })}</div>{catalogState.loadMoreError && <p className="builder-load-more-error" role="alert">{catalogState.loadMoreError} <Button variant="ghost" onClick={() => void loadCatalog(catalogState.pagination.page + 1, true)}>ลองอีกครั้ง</Button></p>}{catalogState.pagination.hasMore && <Button className="builder-load-more" variant="outline" disabled={catalogState.loadingMore} onClick={() => void loadCatalog(catalogState.pagination.page + 1, true)}>{catalogState.loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}</Button>}</>}
        </aside>

        <section className="builder-home builder-panel">
          <header className="builder-panel-heading"><div><h2>บ้านของฉัน</h2></div><em>{homeItems.length ? `${homeItems.length} รายการ` : 'กด + เพื่อเพิ่มอุปกรณ์'}</em></header>
          <div className={`builder-dropzone ${homeItems.length ? 'has-items' : ''}`}>{autosaveState.phase === 'idle' || autosaveState.phase === 'loading' ? <div className="builder-catalog-state" role="status">กำลังโหลดอุปกรณ์ในบ้าน…</div> : homeItems.length === 0 ? <div className="builder-empty"><i><Plus aria-hidden="true" /></i><h3>ยังไม่มีเครื่องใช้ไฟฟ้า</h3><p>กดเครื่องหมายบวกบนการ์ดเครื่องใช้ไฟฟ้า<br />เพื่อเพิ่มเข้าบ้านของคุณ</p><span>บันทึกอัตโนมัติเมื่อเพิ่มหรือแก้ไขอุปกรณ์</span>{!readOnly && <Button className="builder-empty-add" onClick={() => setMobilePanel('catalog')}>เลือกเครื่องใช้ไฟฟ้า <Plus aria-hidden="true" /></Button>}</div> : <div className="builder-home-list">{homeItems.map((item) => {
            const kwh = itemEnergyById.get(item.instanceId) ?? 0;
            const profile = getUsageProfile(item.usageProfileId);
            const schedule = getHomeUsageSchedule(item);
            return <Card className="builder-home-item" key={item.instanceId}>
              <div className="builder-home-item-head"><div className="builder-home-image"><Image src={item.image} alt="" width={88} height={88} /></div><div className="builder-item-name"><span>{item.brand}</span><b>{item.name}</b><small>{item.model}</small><em>{profile.description}</em></div><Button variant="ghost" size="icon" disabled={readOnly || !canMutate} onClick={() => editItems((current) => current.filter((entry) => entry.instanceId !== item.instanceId))} aria-label={`ลบ ${item.name}`}><Trash2 aria-hidden="true" /></Button></div>
              <div className="builder-home-item-controls"><NumberStepper disabled={readOnly || !canMutate} label="จำนวน" unit="เครื่อง" value={item.quantity} min={1} max={99} step={1} onChange={(value) => updateItem(item.instanceId, 'quantity', value)} onEmpty={() => editItems((current) => current.filter((entry) => entry.instanceId !== item.instanceId))} />{profile.inputKind === 'cycles' && <NumberStepper disabled={readOnly || !canMutate} label="รอบ / เดือน" unit="รอบ" value={item.cyclesPerMonth ?? profile.defaultCyclesPerMonth ?? 0} min={profile.min} max={profile.max} step={profile.step} onChange={(value) => updateItem(item.instanceId, 'cyclesPerMonth', value)} onEmpty={() => updateItem(item.instanceId, 'cyclesPerMonth', 0)} />}{profile.inputKind === 'fixed' && <div className="builder-fixed-usage"><b>24 ชม. / วัน</b><span>คิดตาม duty cycle</span></div>}<div className="builder-item-energy"><b>{formatNumber(kwh, 1)}</b><span>kWh / เดือน</span></div></div>
              <div className="builder-usage-schedule"><div className="builder-usage-schedule-header"><span>ช่วงที่ใช้งาน</span>{profile.inputKind === 'hours' && <><small>รวม {formatNumber(scheduleHours(schedule), 2)} ชม. / วัน</small><button type="button" disabled={readOnly || !canMutate} onClick={() => setAllDay(item.instanceId)}>ตั้งเป็นทั้งวัน</button></>}{profile.inputKind === 'fixed' && <small>เปิดตลอดวัน</small>}{profile.inputKind === 'cycles' && <small>เลือกช่วงที่มักใช้งาน</small>}</div><div className="builder-period-chips">{USAGE_PERIODS.map((period) => { const meta = periodLabels[period]; const selected = schedule.kind === 'all_day' || (schedule.kind === 'hours' ? schedule.hoursByPeriod[period] > 0 : schedule.periods.includes(period)); const locked = schedule.kind === 'all_day' || (schedule.kind === 'periods' && selected && schedule.periods.length === 1); return <button type="button" className={`builder-period-chip ${selected ? 'selected' : ''}`} key={period} aria-pressed={selected} aria-label={`${meta.label} ${meta.range}`} disabled={readOnly || !canMutate || locked} onClick={() => updateSchedule(item.instanceId, period)}>{meta.label}<small>{meta.range}</small></button>; })}</div>{schedule.kind === 'hours' && <div className="builder-period-hours">{USAGE_PERIODS.filter((period) => schedule.hoursByPeriod[period] > 0).map((period) => <NumberStepper disabled={readOnly || !canMutate} key={period} label={`${periodLabels[period].label} ${periodLabels[period].range}`} unit="ชม." value={schedule.hoursByPeriod[period]} min={profile.step} max={6} step={profile.step} onChange={(value) => updateScheduleHours(item.instanceId, period, value)} onEmpty={() => updateScheduleHours(item.instanceId, period, 0)} />)}</div>}</div>
            </Card>;
          })}</div>}</div>
          <footer className="builder-method"><i><Info aria-hidden="true" /></i><p><b>วิธีคำนวณประมาณการ</b><span>เลือกสูตรตามชนิดอุปกรณ์ ใช้ค่า profile มาตรฐาน และคิดค่าไฟตาม tariff บ้านอยู่อาศัยที่มีผลในเดือนนี้</span></p></footer>
        </section>
      </section>
    </main>
  </div>;
}
