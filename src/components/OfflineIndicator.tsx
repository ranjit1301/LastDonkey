import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full bg-[#3D2B08] border border-[#F0B429]/55 px-3.5 py-1.5 text-xs font-semibold text-[#FEF3C7] shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#F0B429]" />
      <span>Offline — Practice vs Bots &amp; Pass-and-Play still work</span>
    </div>
  );
};
