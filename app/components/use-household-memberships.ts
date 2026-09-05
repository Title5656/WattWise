'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasUnsavedForms } from '@/lib/unsaved-forms';
import {
  createHouseholdMembershipsLifecycle,
  type MembershipsState,
} from '@/lib/household-client-lifecycle';

export function useHouseholdMemberships(): MembershipsState & { refresh(): Promise<void> } {
  const router = useRouter();
  const [lifecycle] = useState(() => createHouseholdMembershipsLifecycle(fetch));
  const [state, setState] = useState<MembershipsState>(() => lifecycle.getState());
  const refresh = useCallback(() => lifecycle.refresh(), [lifecycle]);

  useEffect(() => {
    const unsubscribe = lifecycle.subscribe(setState);
    const refreshOnFocus = () => { if (!hasUnsavedForms()) void lifecycle.focus(); };
    const refreshOnVisibility = () => { if (!hasUnsavedForms()) void lifecycle.visibilityChanged(document.visibilityState); };
    void lifecycle.mount();
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
      unsubscribe();
      lifecycle.dispose();
    };
  }, [lifecycle]);

  useEffect(() => {
    if (state.phase !== 'profile-required') return;
    const returnTo = `${location.pathname}${location.search}`;
    router.replace(`/onboarding?returnTo=${encodeURIComponent(returnTo)}`);
  }, [router, state.phase]);

  return { ...state, refresh };
}

export function useHouseholdContext(householdId: string) {
  const memberships = useHouseholdMemberships();
  if (memberships.phase !== 'ready') return { ...memberships, household: null, phase: memberships.phase };
  const household = memberships.households.find((candidate) => candidate.id === householdId) ?? null;
  if (!household) return { ...memberships, household: null, phase: 'access-denied' as const };
  return { ...memberships, household, phase: 'ready' as const };
}
