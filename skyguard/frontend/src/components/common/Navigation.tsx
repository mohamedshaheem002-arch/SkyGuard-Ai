import React from 'react';
import {
  LayoutDashboard,
  MapPin,
  Radio,
  AlertTriangle,
  UploadCloud,
  CheckCircle2,
} from 'lucide-react';
import type { NavigationTab } from '../../types';

interface NavigationProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  activeAlertsCount?: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  activeAlertsCount = 0,
}) => {
  const tabs = [
    { id: 'overview' as NavigationTab, label: 'Overview', icon: LayoutDashboard },
    { id: 'map' as NavigationTab, label: 'Live Map', icon: MapPin },
    { id: 'stations' as NavigationTab, label: 'Stations', icon: Radio },
    {
      id: 'alerts' as NavigationTab,
      label: 'Alerts',
      icon: AlertTriangle,
      badge: activeAlertsCount > 0 ? activeAlertsCount : undefined,
    },
    { id: 'test' as NavigationTab, label: 'Test / Replay', icon: UploadCloud },
    { id: 'benchmarks' as NavigationTab, label: 'Benchmarks', icon: CheckCircle2 },
  ];

  return (
    <nav className="bg-white border-b border-slate-200 px-6 flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap cursor-pointer ${
              isActive
                ? 'border-sky-700 text-sky-800 bg-sky-50/40'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-sky-700' : 'text-slate-400'}`} />
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                  isActive ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
