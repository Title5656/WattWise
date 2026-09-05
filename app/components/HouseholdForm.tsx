'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createHouseholdCreationLifecycle, createHouseholdEditLifecycle } from '@/lib/household-client-lifecycle';
import type { HouseholdMembership } from '@/lib/household-ui';
import { registerUnsavedForm } from '@/lib/unsaved-forms';
import { HouseholdAccessState } from './HouseholdAccessState';

export function HouseholdForm({ household, onSaved, onCancel }: {
  household?: HouseholdMembership;
  onSaved: (household: HouseholdMembership) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(household?.name ?? '');
  const [province, setProvince] = useState(household?.province ?? '');
  const [provider, setProvider] = useState(household?.electricityProvider ?? '');
  const [mutation] = useState(() => household
    ? createHouseholdEditLifecycle(fetch, household.id)
    : createHouseholdCreationLifecycle(fetch));
  const [state, setState] = useState(() => mutation.getState());
  const releaseDirty = useRef<() => void>(() => {});
  const dirty = name !== (household?.name ?? '') || province !== (household?.province ?? '') || provider !== (household?.electricityProvider ?? '');
  const saving = state.phase === 'submitting';
  const legacyProvider = household?.electricityProvider;

  useLayoutEffect(() => {
    releaseDirty.current = dirty || saving ? registerUnsavedForm() : () => {};
    return () => releaseDirty.current();
  }, [dirty, saving]);

  useEffect(() => {
    const unsubscribe = mutation.subscribe(setState);
    mutation.mount();
    return () => { unsubscribe(); mutation.dispose(); };
  }, [mutation]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    await mutation.submit({ name: name.trim(), province: province.trim() || null, electricityProvider: provider || null }, (saved) => {
      releaseDirty.current();
      onSaved(saved);
    });
  }

  if (state.phase === 'session-expired') return <HouseholdAccessState embedded phase="session-expired" />;
  return <form className="household-form" onSubmit={submit}>
    <fieldset disabled={saving || state.phase === 'access-denied'}>
      <label>ชื่อบ้าน<Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="เช่น บ้านสวน" /></label>
      <label>จังหวัด <small>ไม่บังคับ</small><Input value={province} onChange={(event) => setProvince(event.target.value)} maxLength={100} placeholder="เช่น เชียงใหม่" /></label>
      <label>ผู้ให้บริการไฟฟ้า<select value={provider} onChange={(event) => setProvider(event.target.value)}>
        <option value="">ยังไม่ระบุ</option>
        <option value="PEA">PEA · การไฟฟ้าส่วนภูมิภาค</option>
        <option value="MEA">MEA · การไฟฟ้านครหลวง</option>
        {legacyProvider && !['PEA', 'MEA'].includes(legacyProvider) && <option value={legacyProvider}>{legacyProvider} · ข้อมูลเดิม</option>}
      </select></label>
      <p className="account-muted">ผู้ให้บริการเป็นข้อมูลของบ้าน การประมาณค่าไฟใช้สูตรบ้านอยู่อาศัยเดิม</p>
    </fieldset>
    {state.error && <p className="account-error" role="alert">{state.error}</p>}
    <div className="account-actions">
      <Button type="submit" disabled={saving || state.phase === 'access-denied' || !name.trim() || (!!household && !dirty)}>
        <Save aria-hidden="true" />{saving ? 'กำลังบันทึก...' : household ? 'บันทึกข้อมูลบ้าน' : 'สร้างบ้านและเริ่มใช้งาน'}
      </Button>
      {onCancel && <Button type="button" variant="outline" disabled={saving} onClick={() => {
        if (dirty && !window.confirm('ข้อมูลที่แก้ไขยังไม่ได้บันทึก ต้องการยกเลิกหรือไม่?')) return;
        releaseDirty.current();
        onCancel();
      }}>ยกเลิก</Button>}
    </div>
  </form>;
}
