import type { LucideIcon } from 'lucide-react';

/** A display-only summary; callers provide values from the existing engine. */
export function MetricCard({ icon: Icon, label, value, unit, detail, tone = 'green' }: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit: string;
  detail: string;
  tone?: 'green' | 'orange' | 'teal' | 'blue';
}) {
  return <article className={`metric-card metric-${tone}`}>
    <span className="metric-icon"><Icon aria-hidden="true" /></span>
    <div className="metric-copy"><h2>{label}</h2><p className="metric-value">{value} <small>{unit}</small></p><em>{detail}</em></div>
  </article>;
}
