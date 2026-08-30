export type DashboardLifecycle = {
  mount(): number;
  unmount(generation: number): void;
  currentGeneration(): number | null;
  isCurrent(generation: number): boolean;
};

export function createDashboardLifecycle(): DashboardLifecycle {
  let generation = 0;
  let mounted = false;

  return {
    mount() {
      generation += 1;
      mounted = true;
      return generation;
    },
    unmount(candidate) {
      if (!mounted || candidate !== generation) return;
      mounted = false;
      generation += 1;
    },
    currentGeneration() {
      return mounted ? generation : null;
    },
    isCurrent(candidate) {
      return mounted && candidate === generation;
    },
  };
}

type MutationBody = { error?: string };

type MutationResponse<Body extends MutationBody> = {
  ok: boolean;
  json(): Promise<Body>;
};

export async function runDashboardMutation<Body extends MutationBody>({
  lifecycle,
  generation,
  request,
  failureMessage,
  onSuccess,
  onError,
  onSettled,
  refresh,
}: {
  lifecycle: DashboardLifecycle;
  generation: number;
  request: () => Promise<MutationResponse<Body>>;
  failureMessage: string;
  onSuccess: (body: Body) => void;
  onError: (message: string) => void;
  onSettled: () => void;
  refresh: () => Promise<void>;
}) {
  try {
    const response = await request();
    if (!lifecycle.isCurrent(generation)) return;

    const body = await response.json();
    if (!lifecycle.isCurrent(generation)) return;
    if (!response.ok) throw new Error(body.error ?? failureMessage);

    onSuccess(body);
    if (!lifecycle.isCurrent(generation)) return;
    await refresh();
  } catch (error) {
    if (!lifecycle.isCurrent(generation)) return;
    onError(error instanceof Error ? error.message : failureMessage);
  } finally {
    if (lifecycle.isCurrent(generation)) onSettled();
  }
}
