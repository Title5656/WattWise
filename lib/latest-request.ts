export type LatestRequest = {
  generation: number;
  signal: AbortSignal;
};

export type LatestRequestTracker = {
  begin(): LatestRequest;
  isLatest(generation: number): boolean;
  cancel(): void;
};

export function createLatestRequestTracker(): LatestRequestTracker {
  let generation = 0;
  let controller: AbortController | null = null;

  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      return { generation, signal: controller.signal };
    },
    isLatest(candidate) {
      return controller !== null && candidate === generation;
    },
    cancel() {
      controller?.abort();
      controller = null;
      generation += 1;
    },
  };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
