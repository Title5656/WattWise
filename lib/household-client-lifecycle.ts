import type { CurrentUser, HouseholdMembership } from './household-ui';

export type MembershipsPhase = 'loading' | 'ready' | 'profile-required' | 'session-expired' | 'error';

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
  init: {
    cache?: 'no-store';
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: 'same-origin';
    signal: AbortSignal;
  },
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
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const meResponse = await fetcher('/api/me', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        });
        if (!isCurrent()) return;
        if (meResponse.status === 401) {
          publish({ ...emptyMembershipsState, phase: 'session-expired' });
          return;
        }
        if (!meResponse.ok) throw new Error('ไม่สามารถโหลดข้อมูลบัญชีได้');
        const me = await meResponse.json() as { user?: CurrentUser };
        if (!isCurrent()) return;
        if (!me.user?.id || !me.user.email) throw new Error('ข้อมูลบัญชีไม่สมบูรณ์');
        if (me.user.needsDisplayName) {
          publish({ ...emptyMembershipsState, phase: 'profile-required', user: me.user });
          return;
        }

        const householdsResponse = await fetcher('/api/households', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        });
        if (!isCurrent()) return;
        if (householdsResponse.status === 401) {
          publish({ ...emptyMembershipsState, phase: 'session-expired' });
          return;
        }
        if (!householdsResponse.ok) throw new Error('ไม่สามารถโหลดรายชื่อบ้านได้');
        const result = await householdsResponse.json() as { userId?: unknown; households?: HouseholdMembership[] };
        if (!isCurrent()) return;
        if (typeof result.userId !== 'string' || !Array.isArray(result.households)) {
          throw new Error('ข้อมูลรายชื่อบ้านไม่สมบูรณ์');
        }
        if (result.userId !== me.user.id) {
          if (attempt === 0) continue;
          throw new Error('บัญชีมีการเปลี่ยนแปลงระหว่างโหลดข้อมูล');
        }
        publish({ phase: 'ready', user: me.user, households: result.households, error: '' });
        return;
      }
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
  phase: 'idle' | 'submitting' | 'error' | 'session-expired' | 'access-denied';
  error: string;
};

export type HouseholdCreationInput = {
  name: string;
  province?: string | null;
  electricityProvider?: string | null;
};

const initialCreationState: HouseholdCreationState = { phase: 'idle', error: '' };

export function createHouseholdCreationLifecycle(fetcher: ClientFetcher) {
  return createHouseholdMutationLifecycle(fetcher, '/api/households', 'POST');
}

export function createHouseholdEditLifecycle(fetcher: ClientFetcher, householdId: string) {
  return createHouseholdMutationLifecycle(fetcher, `/api/households/${encodeURIComponent(householdId)}`, 'PATCH');
}

function createHouseholdMutationLifecycle(fetcher: ClientFetcher, url: string, method: 'POST' | 'PATCH') {
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
      if (!mounted || state.phase === 'submitting' || state.phase === 'session-expired' || state.phase === 'access-denied') return false;
      generation += 1;
      const candidate = generation;
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      const isCurrent = () => mounted && candidate === generation && !signal.aborted;
      publish({ phase: 'submitting', error: '' });

      try {
        const response = await fetcher(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        });
        if (!isCurrent()) return false;
        if (response.status === 401) {
          publish({ phase: 'session-expired', error: '' });
          return false;
        }
        if (response.status === 403 || response.status === 404) {
          publish({ phase: 'access-denied', error: 'คุณไม่มีสิทธิ์แก้ไขบ้านนี้ หรือบ้านนี้ไม่พร้อมใช้งานแล้ว' });
          return false;
        }
        if (!response.ok) {
          publish({ phase: 'error', error: response.status === 400
            ? 'กรุณาตรวจสอบชื่อบ้าน จังหวัด และผู้ให้บริการไฟฟ้า'
            : 'บันทึกบ้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
          return false;
        }
        const body = await response.json() as { household?: HouseholdMembership; error?: string };
        if (!isCurrent()) return false;
        if (!body.household?.id) throw new Error('Incomplete household response');
        onCreated(body.household);
        return true;
      } catch {
        if (!isCurrent()) return false;
        publish({
          phase: 'error',
          error: 'บันทึกบ้านไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่',
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
