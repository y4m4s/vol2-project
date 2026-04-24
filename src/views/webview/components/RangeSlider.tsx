import React from "react";

interface RangeSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

export function RangeSlider({ id, label, value, min, max, step = 1, unit = "", onChange }: RangeSliderProps) {
  return (
    <div className="range-group">
      <div className="range-header">
        <span className="range-label">{label}</span>
        <span className="range-value">{value}{unit}</span>
      </div>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
