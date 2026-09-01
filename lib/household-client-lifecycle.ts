import type { CurrentUser, HouseholdMembership } from './household-ui';

export type MembershipsPhase = 'loading' | 'ready' | 'session-expired' | 'error';

export type MembershipsState = {
  phase: MembershipsPhase;
  user: CurrentUser | null;
  households: HouseholdMembership[];
  error: string;
};

type ResponseLike = {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
};

type ClientFetcher = (
  url: string,
  init: { cache?: 'no-store'; method?: string; headers?: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<ResponseLike>;

type StateListener<State> = (state: State) => void;

const emptyMembershipsState: MembershipsState = {
  phase: 'loading',
  user: null,
  households: [],
  error: '',
};

export function householdContentScopeKey(
  user: CurrentUser,
  household: HouseholdMembership,
): string {
  return JSON.stringify([user.id, household.id, household.role]);
}

export function createHouseholdMembershipsLifecycle(fetcher: ClientFetcher) {
  let mounted = false;
  let generation = 0;
  let request: AbortController | null = null;
  let state = emptyMembershipsState;
  const listeners = new Set<StateListener<MembershipsState>>();

  function publish(nextState: MembershipsState) {
    if (!mounted) return;
    state = nextState;
    listeners.forEach((listener) => listener(state));
  }

  async function refresh() {
    if (!mounted) return;
    generation += 1;
    const candidate = generation;
    request?.abort();
    request = new AbortController();
    const { signal } = request;
    publish(emptyMembershipsState);

    const isCurrent = () => mounted && candidate === generation && !signal.aborted;
    try {
      const meResponse = await fetcher('/api/me', { cache: 'no-store', signal });
      if (!isCurrent()) return;
      if (meResponse.status === 401) {
        publish({ ...emptyMembershipsState, phase: 'session-expired' });
        return;
      }
      if (!meResponse.ok) throw new Error('ไม่สามารถโหลดข้อมูลบัญชีได้');
      const me = await meResponse.json() as { user?: CurrentUser };
      if (!isCurrent()) return;
      if (!me.user?.id || !me.user.email) throw new Error('ข้อมูลบัญชีไม่สมบูรณ์');

      const householdsResponse = await fetcher('/api/households', { cache: 'no-store', signal });
      if (!isCurrent()) return;
      if (householdsResponse.status === 401) {
        publish({ ...emptyMembershipsState, phase: 'session-expired' });
        return;
      }
      if (!householdsResponse.ok) throw new Error('ไม่สามารถโหลดรายชื่อบ้านได้');
      const result = await householdsResponse.json() as { households?: HouseholdMembership[] };
      if (!isCurrent()) return;
      if (!Array.isArray(result.households)) throw new Error('ข้อมูลรายชื่อบ้านไม่สมบูรณ์');
      publish({ phase: 'ready', user: me.user, households: result.households, error: '' });
    } catch (error) {
      if (!isCurrent()) return;
      publish({
        ...emptyMembershipsState,
        phase: 'error',
        error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
      });
    }
  }

  return {
    mount() {
      mounted = true;
      return refresh();
    },
    refresh,
    focus() {
      return refresh();
    },
    visibilityChanged(visibilityState: DocumentVisibilityState) {
      return visibilityState === 'visible' ? refresh() : Promise.resolve();
    },
    dispose() {
      if (!mounted) return;
      mounted = false;
      generation += 1;
      request?.abort();
      request = null;
    },
    subscribe(listener: StateListener<MembershipsState>) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState() {
      return state;
    },
  };
}

export type DisposableResource = { dispose(): void };

export function createScopedResourceSlot<Resource extends DisposableResource>() {
  let current: { scopeKey: string; resource: Resource } | null = null;

  return {
    replace(scopeKey: string, create: () => Resource): Resource {
      if (current?.scopeKey === scopeKey) return current.resource;
      current?.resource.dispose();
      const resource = create();
      current = { scopeKey, resource };
      return resource;
    },
    clear(scopeKey?: string) {
      if (!current || (scopeKey !== undefined && current.scopeKey !== scopeKey)) return;
      current.resource.dispose();
      current = null;
    },
  };
}

export type HouseholdCreationState = {
  phase: 'idle' | 'submitting' | 'error' | 'session-expired';
  error: string;
};

export type HouseholdCreationInput = {
  name: string;
  province?: string;
  electricityProvider?: string;
};

const initialCreationState: HouseholdCreationState = { phase: 'idle', error: '' };

export function createHouseholdCreationLifecycle(fetcher: ClientFetcher) {
  let mounted = false;
  let generation = 0;
  let request: AbortController | null = null;
  let state = initialCreationState;
  const listeners = new Set<StateListener<HouseholdCreationState>>();

  function publish(nextState: HouseholdCreationState) {
    if (!mounted) return;
    state = nextState;
    listeners.forEach((listener) => listener(state));
  }

  return {
    mount() {
      mounted = true;
    },
    async submit(input: HouseholdCreationInput, onCreated: (household: HouseholdMembership) => void) {
      if (!mounted || state.phase === 'submitting' || state.phase === 'session-expired') return false;
      generation += 1;
      const candidate = generation;
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      const isCurrent = () => mounted && candidate === generation && !signal.aborted;
      publish({ phase: 'submitting', error: '' });

      try {
        const response = await fetcher('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        });
        if (!isCurrent()) return false;
        if (response.status === 401) {
          publish({ phase: 'session-expired', error: '' });
          return false;
        }
        const body = await response.json() as { household?: HouseholdMembership; error?: string };
        if (!isCurrent()) return false;
        if (!response.ok || !body.household) throw new Error(body.error ?? 'สร้างบ้านไม่สำเร็จ');
        onCreated(body.household);
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        publish({
          phase: 'error',
          error: error instanceof Error ? error.message : 'สร้างบ้านไม่สำเร็จ',
        });
        return false;
      }
    },
    dispose() {
      if (!mounted) return;
      mounted = false;
      generation += 1;
      request?.abort();
      request = null;
    },
    subscribe(listener: StateListener<HouseholdCreationState>) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState() {
      return state;
    },
  };
}
