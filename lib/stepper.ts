export type StepperOptions = { min: number; max?: number; step: number };

export function parseStepperInput(raw: string, options: StepperOptions): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const bounded = Math.max(options.min, parsed);
  return options.max === undefined ? bounded : Math.min(options.max, bounded);
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
