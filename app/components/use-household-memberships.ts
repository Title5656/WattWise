'use client';

import { useEffect, useState } from 'react';
import type { CurrentUser, HouseholdMembership } from '@/lib/household-ui';

export type MembershipsPhase = 'loading' | 'ready' | 'session-expired' | 'error';

export type MembershipsState = {
  phase: MembershipsPhase;
  user: CurrentUser | null;
  households: HouseholdMembership[];
  error: string;
};

const initialState: MembershipsState = {
  phase: 'loading',
  user: null,
  households: [],
  error: '',
};

export function useHouseholdMemberships(): MembershipsState {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const meResponse = await fetch('/api/me', { cache: 'no-store', signal: controller.signal });
        if (meResponse.status === 401) {
          setState({ ...initialState, phase: 'session-expired' });
          return;
        }
        if (!meResponse.ok) throw new Error('ไม่สามารถโหลดข้อมูลบัญชีได้');
        const me = await meResponse.json() as { user?: CurrentUser };
        if (!me.user?.id || !me.user.email) throw new Error('ข้อมูลบัญชีไม่สมบูรณ์');

        const householdsResponse = await fetch('/api/households', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (householdsResponse.status === 401) {
          setState({ ...initialState, phase: 'session-expired' });
          return;
        }
        if (!householdsResponse.ok) throw new Error('ไม่สามารถโหลดรายชื่อบ้านได้');
        const result = await householdsResponse.json() as { households?: HouseholdMembership[] };
        if (!Array.isArray(result.households)) throw new Error('ข้อมูลรายชื่อบ้านไม่สมบูรณ์');
        setState({ phase: 'ready', user: me.user, households: result.households, error: '' });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          ...initialState,
          phase: 'error',
          error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
        });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  return state;
}

export function useHouseholdContext(householdId: string) {
  const memberships = useHouseholdMemberships();
  if (memberships.phase !== 'ready') return { ...memberships, household: null, phase: memberships.phase };
  const household = memberships.households.find((candidate) => candidate.id === householdId) ?? null;
  if (!household) return { ...memberships, household: null, phase: 'access-denied' as const };
  return { ...memberships, household, phase: 'ready' as const };
}
