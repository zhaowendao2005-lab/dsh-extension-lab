import React from '../runtime';
export function InfoTooltip({ id,text }: {
  id: string;
  text: string;
}) {
  return <span className="mit-tooltip">
    <span tabIndex={0} className="mit-info-icon" aria-label="说明" aria-describedby={id}>i
    </span>
    <span id={id} role="tooltip" className="mit-tooltip-content">
      {text}
    </span>
  </span>;
}
