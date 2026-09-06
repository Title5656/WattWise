'use client';

import { useId } from 'react';

/** SVG only: a single entrance animation, no timers or synthetic live data. */
export function DailyLoadChart({ values, average }: { values: number[]; average: number }) {
  const id = useId();
  const peak = Math.max(...values, 0);
  const ceiling = Math.max(peak, average, 0.1) * 1.2;
  const x = (index: number) => 64 + index * 896 / Math.max(values.length - 1, 1);
  const y = (value: number) => 244 - value / ceiling * 196;
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const peakIndex = values.indexOf(peak);
  return <div className="usage-line-chart">
    <div className="load-chart-legend"><span><i />โหลดโดยประมาณ</span><span><i className="average" />ค่าเฉลี่ยทั้งวัน</span><small>หน่วย kW · ทุก 2 ชั่วโมง</small></div>
    <svg viewBox="0 0 1000 300" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>โหลดไฟภายในบ้านตามช่วงเวลา</title>
      <desc id={`${id}-description`}>ประมาณการจากเวลาใช้งานที่ตั้งไว้ ไม่ใช่ค่าจากมิเตอร์สด โหลดเฉลี่ย {average.toFixed(2)} kW โหลดสูงสุด {peak.toFixed(2)} kW</desc>
      <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--green)" stopOpacity=".24" /><stop offset="100%" stopColor="var(--green)" stopOpacity=".02" /></linearGradient></defs>
      {[0, 0.25, 0.5, 0.75, 1].map(fraction => <g key={fraction}><line className="usage-grid" x1="64" x2="960" y1={y(ceiling * fraction)} y2={y(ceiling * fraction)} /><text className="usage-time" x="48" y={y(ceiling * fraction) + 4} textAnchor="end">{(ceiling * fraction).toFixed(2)}</text></g>)}
      <g className="usage-series">
        <polygon points={`64,244 ${points} ${x(values.length - 1)},244`} fill={`url(#${id}-fill)`} />
        <polyline className="usage-line" points={points} />
      </g>
      <line className="usage-average" x1="64" x2="960" y1={y(average)} y2={y(average)} />
      {values.map((value, index) => {
        const time = `${String(index * 2).padStart(2, '0')}:00`;
        const isPeak = peak > 0 && index === peakIndex;
        return <g key={time} className={`usage-sample${isPeak ? ' is-peak' : ''}`} tabIndex={0} aria-label={`${time}: ${value.toFixed(2)} kW${isPeak ? ' สูงสุด' : ''}`}>
          <title>{time}: {value.toFixed(2)} kW</title>
          <circle className="usage-hit" cx={x(index)} cy={y(value)} r="22" />
          {isPeak && <circle className="usage-peak-halo" cx={x(index)} cy={y(value)} r="12" />}
          <circle className="usage-point" cx={x(index)} cy={y(value)} r={isPeak ? 5 : 3.5} />
          <text className="usage-value" x={x(index)} y={y(value) - 20} textAnchor="middle">{value.toFixed(2)}</text>
          <text className="usage-time" x={x(index)} y="278" textAnchor="middle">{time}</text>
        </g>;
      })}
    </svg>
  </div>;
}
