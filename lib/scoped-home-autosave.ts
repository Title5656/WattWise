import type { HomeAppliance } from './home-config.ts';
import {
  canonicalizePendingHomeSave,
  clearScopedPendingHomeSave,
  homeSaveLockName,
  readScopedPendingHomeSave,
  rebaseScopedPendingHomeSave,
  scopedPendingHomeSaveRequestBody,
  stageScopedPendingHomeSave,
  type HomeSaveScope,
  type ScopedHomeSaveEnvelope,
} from './home-save-outbox.ts';
import { isAbortError } from './latest-request.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type AutosaveResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type AutosaveFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<AutosaveResponse>;

type LockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

type Scheduler = {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
};

export type ScopedHomeAutosavePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'access-denied'
  | 'session-expired'
  | 'retryable-error';

export type ScopedHomeAutosaveState = {
  phase: ScopedHomeAutosavePhase;
  scope: HomeSaveScope | null;
  generation: number;
  revision: number | null;
  items: HomeAppliance[];
  currentRevision: number | null;
};

type Session = {
  scope: HomeSaveScope;
  generation: number;
  stopped: boolean;
  blocked: boolean;
  loaded: boolean;
  revision: number | null;
  confirmedBody: string | null;
  items: HomeAppliance[];
  pending: ScopedHomeSaveEnvelope | null;
  inFlight: ScopedHomeSaveEnvelope | null;
  timer: unknown;
  requestController: AbortController | null;
  queue: Promise<void>;
};

export type ScopedHomeAutosaveController = {
  activate(scope: HomeSaveScope): Promise<void>;
  edit(items: HomeAppliance[]): boolean;
  retry(): void;
  discardDraftAndReload(): Promise<void>;
  logout(): void;
  dispose(): void;
  getState(): ScopedHomeAutosaveState;
  subscribe(listener: (state: ScopedHomeAutosaveState) => void): () => void;
};

export type ScopedHomeAutosaveOptions = {
  storage: StorageLike;
  fetch: AutosaveFetch;
  locks?: LockManager;
  scheduler?: Scheduler;
  debounceMs?: number;
  now?: () => number;
};

const defaultScheduler: Scheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function homeUrl(scope: HomeSaveScope): string {
  return `/api/households/${encodeURIComponent(scope.householdId)}/home`;
}

function canonicalBody(items: HomeAppliance[]): string | null {
  return canonicalizePendingHomeSave(JSON.stringify({ items }));
}

function parsedItems(body: string): HomeAppliance[] {
  return (JSON.parse(body) as { items: HomeAppliance[] }).items;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function envelopeMatches(left: ScopedHomeSaveEnvelope | null, right: ScopedHomeSaveEnvelope): boolean {
  return left !== null
    && left.userId === right.userId
    && left.householdId === right.householdId
    && left.expectedRevision === right.expectedRevision
    && left.body === right.body
    && left.updatedAt === right.updatedAt;
}

export function createScopedHomeAutosaveController({
  storage,
  fetch,
  locks,
  scheduler = defaultScheduler,
  debounceMs = 300,
  now = Date.now,
}: ScopedHomeAutosaveOptions): ScopedHomeAutosaveController {
  let generation = 0;
  let active: Session | null = null;
  let state: ScopedHomeAutosaveState = {
    phase: 'idle',
    scope: null,
    generation,
    revision: null,
    items: [],
    currentRevision: null,
  };
  const listeners = new Set<(next: ScopedHomeAutosaveState) => void>();

  const publish = (next: ScopedHomeAutosaveState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  const isActive = (session: Session) => active === session
    && !session.stopped
    && session.generation === generation;

  const cancelTimer = (session: Session) => {
    if (session.timer === null) return;
    scheduler.clear(session.timer);
    session.timer = null;
  };

  const stopSession = (session: Session) => {
    session.stopped = true;
    session.blocked = true;
    cancelTimer(session);
    session.requestController?.abort();
    session.requestController = null;
  };

  const stopActive = (showIdle: boolean) => {
    if (active) stopSession(active);
    active = null;
    generation += 1;
    if (showIdle) {
      publish({
        phase: 'idle',
        scope: null,
        generation,
        revision: null,
        items: [],
        currentRevision: null,
      });
    }
  };

  const expire = (session: Session) => {
    if (!isActive(session)) return;
    const expiredScope = session.scope;
    const items = session.items;
    const revision = session.revision;
    stopSession(session);
    active = null;
    generation += 1;
    publish({
      phase: 'session-expired',
      scope: expiredScope,
      generation,
      revision,
      items,
      currentRevision: null,
    });
  };

  const runWithLock = <T>(session: Session, callback: () => Promise<T>): Promise<T> => {
    if (!locks) return callback();
    return locks.request(homeSaveLockName(session.scope), callback);
  };

  const markRetryable = (session: Session) => {
    if (!isActive(session)) return;
    session.blocked = true;
    publish({
      phase: 'retryable-error',
      scope: session.scope,
      generation: session.generation,
      revision: session.revision,
      items: session.items,
      currentRevision: null,
    });
  };

  const denyAccess = (session: Session) => {
    if (!isActive(session)) return;
    session.blocked = true;
    cancelTimer(session);
    publish({
      phase: 'access-denied',
      scope: session.scope,
      generation: session.generation,
      revision: session.revision,
      items: session.items,
      currentRevision: null,
    });
  };

  const queueSave = (session: Session, envelope: ScopedHomeSaveEnvelope) => {
    session.queue = session.queue.catch(() => undefined).then(async () => {
      if (!isActive(session) || session.blocked) return;
      const durable = readScopedPendingHomeSave(storage, session.scope);
      if (!envelopeMatches(durable, envelope)) return;
      await runWithLock(session, async () => {
        if (!isActive(session) || session.blocked) return;
        const lockedPending = readScopedPendingHomeSave(storage, session.scope);
        if (!envelopeMatches(lockedPending, envelope)) return;

        publish({
          phase: 'saving',
          scope: session.scope,
          generation: session.generation,
          revision: session.revision,
          items: session.items,
          currentRevision: null,
        });
        const requestController = new AbortController();
        session.requestController = requestController;
        session.inFlight = envelope;
        try {
          const response = await fetch(homeUrl(session.scope), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: scopedPendingHomeSaveRequestBody(envelope),
            signal: requestController.signal,
          });
          if (!isActive(session)) return;

          if (response.status === 401) {
            expire(session);
            return;
          }
          if (response.status === 403 || response.status === 404) {
            denyAccess(session);
            return;
          }
          if (response.status === 409) {
            const conflict = await response.json() as { code?: unknown; currentRevision?: unknown };
            if (!isActive(session)) return;
            session.blocked = true;
            cancelTimer(session);
            publish({
              phase: 'conflict',
              scope: session.scope,
              generation: session.generation,
              revision: session.revision,
              items: session.items,
              currentRevision: conflict.code === 'HOME_REVISION_CONFLICT' && validRevision(conflict.currentRevision)
                ? conflict.currentRevision
                : null,
            });
            return;
          }
          if (!response.ok) {
            markRetryable(session);
            return;
          }

          const result = await response.json() as { revision?: unknown };
          if (!isActive(session)) return;
          if (!validRevision(result.revision)) {
            markRetryable(session);
            return;
          }

          session.revision = result.revision;
          session.confirmedBody = envelope.body;
          clearScopedPendingHomeSave(storage, session.scope, envelope);
          if (session.pending && !envelopeMatches(session.pending, envelope)) {
            const updatedAt = Math.max(now(), session.pending.updatedAt + 1);
            const rebased = rebaseScopedPendingHomeSave(
              storage,
              session.scope,
              session.pending,
              result.revision,
              updatedAt,
            );
            if (rebased) {
              session.pending = rebased;
              queueSave(session, rebased);
              return;
            }
          }
          if (session.pending && envelopeMatches(session.pending, envelope)) session.pending = null;
          publish({
            phase: 'saved',
            scope: session.scope,
            generation: session.generation,
            revision: result.revision,
            items: session.items,
            currentRevision: null,
          });
        } catch (error) {
          if (!isActive(session) || isAbortError(error)) return;
          markRetryable(session);
        } finally {
          if (session.inFlight === envelope) session.inFlight = null;
          if (session.requestController === requestController) session.requestController = null;
        }
      });
    });
  };

  const scheduleSave = (session: Session) => {
    cancelTimer(session);
    session.timer = scheduler.set(() => {
      session.timer = null;
      if (!isActive(session) || session.blocked || !session.pending) return;
      queueSave(session, session.pending);
    }, debounceMs);
  };

  const activate = async (scope: HomeSaveScope) => {
    stopActive(false);
    generation += 1;
    const session: Session = {
      scope: { ...scope },
      generation,
      stopped: false,
      blocked: false,
      loaded: false,
      revision: null,
      confirmedBody: null,
      items: [],
      pending: null,
      inFlight: null,
      timer: null,
      requestController: null,
      queue: Promise.resolve(),
    };
    active = session;

    const pending = readScopedPendingHomeSave(storage, session.scope);
    if (pending) {
      session.pending = pending;
      session.revision = pending.expectedRevision;
      session.items = parsedItems(pending.body);
    }

    publish({
      phase: 'loading',
      scope: session.scope,
      generation: session.generation,
      revision: session.revision,
      items: session.items,
      currentRevision: null,
    });
    const requestController = new AbortController();
    session.requestController = requestController;
    try {
      const response = await fetch(homeUrl(session.scope), { signal: requestController.signal });
      if (!isActive(session)) return;
      if (response.status === 401) {
        expire(session);
        return;
      }
      if (response.status === 403 || response.status === 404) {
        denyAccess(session);
        return;
      }
      if (!response.ok) {
        markRetryable(session);
        return;
      }
      const snapshot = await response.json() as { revision?: unknown; items?: unknown };
      if (!isActive(session)) return;
      if (!validRevision(snapshot.revision) || !Array.isArray(snapshot.items)) {
        markRetryable(session);
        return;
      }
      const confirmedBody = canonicalBody(snapshot.items as HomeAppliance[]);
      if (!confirmedBody) {
        markRetryable(session);
        return;
      }
      session.loaded = true;
      if (pending) {
        session.confirmedBody = confirmedBody;
        if (snapshot.revision !== pending.expectedRevision) {
          session.blocked = true;
          publish({
            phase: 'conflict',
            scope: session.scope,
            generation: session.generation,
            revision: pending.expectedRevision,
            items: session.items,
            currentRevision: snapshot.revision,
          });
          return;
        }
        publish({
          phase: 'ready',
          scope: session.scope,
          generation: session.generation,
          revision: pending.expectedRevision,
          items: session.items,
          currentRevision: null,
        });
        scheduleSave(session);
        return;
      }
      session.revision = snapshot.revision;
      session.confirmedBody = confirmedBody;
      session.items = snapshot.items as HomeAppliance[];
      publish({
        phase: 'saved',
        scope: session.scope,
        generation: session.generation,
        revision: session.revision,
        items: session.items,
        currentRevision: null,
      });
    } catch (error) {
      if (!isActive(session) || isAbortError(error)) return;
      markRetryable(session);
    } finally {
      if (session.requestController === requestController) session.requestController = null;
    }
  };

  return {
    activate,
    edit(items) {
      const session = active;
      if (!session || !isActive(session) || session.blocked || session.revision === null) return false;
      const body = canonicalBody(items);
      if (!body) return false;
      session.items = items;
      if (body === session.confirmedBody) {
        if (session.inFlight) {
          const updatedAt = Math.max(now(), (session.pending?.updatedAt ?? -1) + 1);
          const pending = stageScopedPendingHomeSave(storage, session.scope, session.revision, body, updatedAt);
          if (!pending) return false;
          session.pending = pending;
          publish({
            phase: 'ready',
            scope: session.scope,
            generation: session.generation,
            revision: session.revision,
            items: session.items,
            currentRevision: null,
          });
          return true;
        }
        if (session.pending) clearScopedPendingHomeSave(storage, session.scope, session.pending);
        session.pending = null;
        cancelTimer(session);
        publish({
          phase: 'saved',
          scope: session.scope,
          generation: session.generation,
          revision: session.revision,
          items: session.items,
          currentRevision: null,
        });
        return true;
      }
      const updatedAt = Math.max(now(), (session.pending?.updatedAt ?? -1) + 1);
      const pending = stageScopedPendingHomeSave(storage, session.scope, session.revision, body, updatedAt);
      if (!pending) return false;
      session.pending = pending;
      publish({
        phase: 'ready',
        scope: session.scope,
        generation: session.generation,
        revision: session.revision,
        items: session.items,
        currentRevision: null,
      });
      scheduleSave(session);
      return true;
    },
    retry() {
      const session = active;
      if (!session || !isActive(session) || state.phase !== 'retryable-error') return;
      session.blocked = false;
      if (!session.loaded) void activate(session.scope);
      else if (session.pending) queueSave(session, session.pending);
      else void activate(session.scope);
    },
    async discardDraftAndReload() {
      const session = active;
      if (!session || !isActive(session) || !session.pending) return;
      const scope = session.scope;
      clearScopedPendingHomeSave(storage, scope, session.pending);
      await activate(scope);
    },
    logout() {
      stopActive(true);
    },
    dispose() {
      stopActive(true);
      listeners.clear();
    },
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
