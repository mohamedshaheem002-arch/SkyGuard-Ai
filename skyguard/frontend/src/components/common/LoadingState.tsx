import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  submessage?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading telemetry data...',
  submessage = 'Polling WMO station network baselines',
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-white rounded-lg border border-slate-200">
      <Loader2 className="w-7 h-7 text-sky-600 animate-spin mb-3" />
      <div className="text-sm font-semibold text-slate-800">{message}</div>
      {submessage && <div className="text-xs text-slate-500 mt-1">{submessage}</div>}
    </div>
  );
};
