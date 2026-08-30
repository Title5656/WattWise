export type StepperOptions = { min: number; max?: number; step: number };

export function parseStepperInput(raw: string, options: StepperOptions): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const bounded = Math.max(options.min, parsed);
  const clamped = options.max === undefined ? bounded : Math.min(options.max, bounded);
  const precision = Math.max(0, (String(options.step).split('.')[1] ?? '').length);
  const snapped = Math.round(clamped / options.step) * options.step;
  const normalized = options.max === undefined
    ? Math.max(options.min, snapped)
    : Math.min(options.max, Math.max(options.min, snapped));
  return Number(normalized.toFixed(precision));
}

export function adjustStepperValue(value: number, delta: number, options: StepperOptions) {
  const precision = Math.max(0, (String(options.step).split('.')[1] ?? '').length);
  const snappedValue = Math.round(value / options.step) * options.step;
  const next = snappedValue + delta;
  const bounded = options.max === undefined
    ? Math.max(options.min, next)
    : Math.min(options.max, Math.max(options.min, next));
  return Number(bounded.toFixed(precision));
}
