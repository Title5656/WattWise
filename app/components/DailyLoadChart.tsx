'use client';

import { useEffect, useId, useRef, useState } from 'react';

/** Display curves stay within each pair of estimated samples; source loads are unchanged. */
export function DailyLoadChart({ values, average }: { values: number[]; average: number }) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(1000);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setChartWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const peak = Math.max(...values, 0);
  const peakIndex = values.indexOf(peak);
  const rawStep = Math.max(peak, average, 0.1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find(value => value * magnitude >= rawStep) ?? 10) * magnitude;
  const ceiling = step * 4;
  const time = (index: number) => `${String(index * 2).padStart(2, '0')}:00`;

  function plot() {
    const width = chartWidth;
    const compact = width < 600;
    const height = compact ? 252 : 280;
    const left = compact ? 38 : 48;
    const right = width - 18;
    const bottom = height - 32;
    const x = (index: number) => left + index * (right - left) / Math.max(values.length - 1, 1);
    const y = (value: number) => bottom - value / ceiling * (bottom - 28);
    const selected = activeIndex !== null && activeIndex < values.length ? activeIndex : peak > 0 ? peakIndex : null;
    const tooltipWidth = compact ? 130 : 154;
    const tooltipX = selected === null ? 0 : Math.max(left, Math.min(x(selected) - tooltipWidth / 2, right - tooltipWidth));
    const tooltipY = selected === null ? 0 : Math.max(4, y(values[selected]) - 78);
    const chartId = id;
    const sampleWidth = (right - left) / Math.max(values.length - 1, 1);
    const curve = values.map((value, index) => {
      if (index === 0) return `M ${x(index)} ${y(value)}`;
      const middle = (x(index - 1) + x(index)) / 2;
      return `C ${middle} ${y(values[index - 1])} ${middle} ${y(value)} ${x(index)} ${y(value)}`;
    }).join(' ');

    return <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={`${chartId}-title ${chartId}-description`}>
      <title id={`${chartId}-title`}>โหลดไฟภายในบ้านตามช่วงเวลา</title>
      <desc id={`${chartId}-description`}>ประมาณการทุก 2 ชั่วโมงจากเวลาใช้งานที่ตั้งไว้ ไม่ใช่ค่าจากมิเตอร์สด โหลดเฉลี่ย {average.toFixed(2)} kW โหลดสูงสุด {peak.toFixed(2)} kW ใช้ Tab เลือกจุดเพื่ออ่านค่า</desc>
      <defs><linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--leaf)" stopOpacity="0.34" /><stop offset="65%" stopColor="var(--leaf)" stopOpacity="0.14" /><stop offset="100%" stopColor="var(--leaf)" stopOpacity="0.02" /></linearGradient></defs>
      <path d={`${curve} L ${x(values.length - 1)} ${bottom} L ${left} ${bottom} Z`} fill={`url(#${chartId}-fill)`} aria-hidden="true" />
      {[0, 1, 2, 3, 4].map(tick => <g key={tick} aria-hidden="true">
        <line className="usage-grid" x1={left} x2={right} y1={y(step * tick)} y2={y(step * tick)} />
        <text className="usage-time" x={left - 10} y={y(step * tick) + 4} textAnchor="end">{Number((step * tick).toFixed(3))}</text>
      </g>)}
      <line className="usage-average" x1={left} x2={right} y1={y(average)} y2={y(average)} aria-hidden="true" />
      <path className="usage-line" d={curve} aria-hidden="true" />
      {selected !== null && <line className="usage-cursor" x1={x(selected)} x2={x(selected)} y1="20" y2={bottom} aria-hidden="true" />}
      {values.map((value, index) => {
        const isPeak = peak > 0 && index === peakIndex;
        const isActive = selected === index;
        const hitLeft = Math.max(left - 10, x(index) - sampleWidth / 2);
        return <g key={index}>
          <g className="usage-sample" role="button" tabIndex={0}
            aria-label={`${time(index)}: ${value.toFixed(2)} kW${isPeak ? ' สูงสุด' : ''}`}
            onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)}
            onClick={() => setActiveIndex(index)}
            onKeyDown={event => {
              if (event.key === 'Escape') setActiveIndex(null);
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveIndex(index); }
            }}>
            {(isPeak || isActive) && <circle className="usage-peak-halo" cx={x(index)} cy={y(value)} r="9" />}
            <circle className="usage-point" cx={x(index)} cy={y(value)} r={isActive || isPeak ? 5 : 0} />
            <rect x={hitLeft} y="20" width={Math.min(x(index) + sampleWidth / 2, right + 10) - hitLeft} height={bottom - 20} fill="transparent" />
          </g>
          {(index % (compact ? 3 : 2) === 0 || index === values.length - 1) && <text className="usage-time" x={x(index)} y={height - 6} textAnchor="middle" aria-hidden="true">{time(index)}</text>}
        </g>;
      })}
      {selected !== null && <g className="usage-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none" aria-hidden="true">
        <rect width={tooltipWidth} height="64" rx="12" />
        <text x="12" y="22">{time(selected)}{selected === peakIndex && peak > 0 ? ' · สูงสุด' : ''}</text>
        <text className="usage-tooltip-value" x="12" y="47">{values[selected].toFixed(2)} kW</text>
      </g>}
    </svg>;
  }

  return <div className="usage-line-chart" ref={container}>
    <div className="load-chart-legend"><span><i />โหลดโดยประมาณ</span><span><i className="average" />ค่าเฉลี่ยทั้งวัน</span><small>หน่วย kW · ทุก 2 ชั่วโมง</small></div>
    {values.length ? <>{plot()}<small className="usage-chart-help">ชี้ แตะ หรือใช้ Tab ที่กราฟเพื่อดูค่าแต่ละช่วงเวลา</small></> : <p className="account-muted">ยังไม่มีข้อมูลช่วงเวลาการใช้ไฟ</p>}
  </div>;
}
