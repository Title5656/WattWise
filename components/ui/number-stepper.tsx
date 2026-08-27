'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { adjustStepperValue, parseStepperInput, type StepperOptions } from '@/lib/stepper';

type NumberStepperProps = StepperOptions & {
  label: string;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
  onEmpty?: () => void;
};

export function NumberStepper({ label, value, unit, min, max, step, onChange, onEmpty }: NumberStepperProps) {
  const [draft, setDraft] = useState(String(value));
  const options = { min, max, step };
  const decrement = () => {
    const next = adjustStepperValue(value, -step, options);
    setDraft(String(next));
    onChange(next);
  };
  const increment = () => {
    const next = adjustStepperValue(value, step, options);
    setDraft(String(next));
    onChange(next);
  };

  return <div className="number-stepper">
    <span className="number-stepper-label">{label}</span>
    <div className="number-stepper-control">
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={decrement} disabled={value <= min} aria-label={`ลด${label}`}><Minus aria-hidden="true" /></button>
      <label>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={draft}
          aria-label={label}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const parsed = parseStepperInput(raw, options);
            if (parsed !== null) onChange(parsed);
          }}
          onBlur={() => { if (!draft.trim()) { setDraft(String(min)); onEmpty?.(); } }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        />
        {unit && <small>{unit}</small>}
      </label>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={increment} disabled={max !== undefined && value >= max} aria-label={`เพิ่ม${label}`}><Plus aria-hidden="true" /></button>
    </div>
  </div>;
}
