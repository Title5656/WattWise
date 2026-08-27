'use client';

import { Minus, Plus } from 'lucide-react';
import { adjustStepperValue, type StepperOptions } from '@/lib/stepper';

type NumberStepperProps = StepperOptions & {
  label: string;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
};

export function NumberStepper({ label, value, unit, min, max, step, onChange }: NumberStepperProps) {
  const options = { min, max, step };
  const decrement = () => onChange(adjustStepperValue(value, -step, options));
  const increment = () => onChange(adjustStepperValue(value, step, options));

  return <div className="number-stepper">
    <span className="number-stepper-label">{label}</span>
    <div className="number-stepper-control">
      <button type="button" onClick={decrement} disabled={value <= min} aria-label={`ลด${label}`}><Minus aria-hidden="true" /></button>
      <label>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
          }}
        />
        {unit && <small>{unit}</small>}
      </label>
      <button type="button" onClick={increment} disabled={value >= max} aria-label={`เพิ่ม${label}`}><Plus aria-hidden="true" /></button>
    </div>
  </div>;
}
