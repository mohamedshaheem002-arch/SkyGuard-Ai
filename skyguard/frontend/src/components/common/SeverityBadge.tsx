import React from 'react';
import type { SeverityType } from '../../types';

interface SeverityBadgeProps {
  severity: SeverityType | string;
  size?: 'sm' | 'md';
}

const SEVERITY_CONFIG: Record<string, { label: string; text: string; bg: string }> = {
  LOW: { label: 'LOW', text: '#475569', bg: '#f1f5f9' },
  MEDIUM: { label: 'MED', text: '#b45309', bg: '#fef3c7' },
  HIGH: { label: 'HIGH', text: '#c2410c', bg: '#ffedd5' },
  CRITICAL: { label: 'CRIT', text: '#b91c1c', bg: '#fee2e2' },
};

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity, size = 'sm' }) => {
  const cfg = SEVERITY_CONFIG[severity] || { label: severity, text: '#64748b', bg: '#f8fafc' };

  return (
    <span
      className={`inline-block font-mono font-medium rounded ${
        size === 'md' ? 'px-2 py-0.5 text-xs font-bold' : 'px-1.5 py-0.5 text-[11px]'
      }`}
      style={{ color: cfg.text, backgroundColor: cfg.bg }}
    >
      {cfg.label}
    </span>
  );
};
