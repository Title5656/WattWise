export type StepperOptions = { min: number; max: number; step: number };

export function adjustStepperValue(value: number, delta: number, options: StepperOptions) {
  const precision = Math.max(0, (String(options.step).split('.')[1] ?? '').length);
  const snappedValue = Math.round(value / options.step) * options.step;
  const next = snappedValue + delta;
  const bounded = Math.min(options.max, Math.max(options.min, next));
  return Number(bounded.toFixed(precision));
}
