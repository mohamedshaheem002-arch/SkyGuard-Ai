import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Service Unavailable',
  message = 'Failed to fetch telemetry from the SkyGuard engine.',
  onRetry,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-red-50/50 rounded-lg border border-red-200">
      <AlertCircle className="w-8 h-8 text-red-600 mb-2" />
      <h3 className="text-sm font-semibold text-red-900">{title}</h3>
      <p className="text-xs text-red-700 max-w-md mt-1 mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-50 transition"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          Retry Connection
        </button>
      )}
    </div>
  );
};
