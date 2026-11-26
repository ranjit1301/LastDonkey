import React from 'react';
import { AlertTriangle, Home, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import type { ConnectionStatusInfo } from '../lib/multiplayerClient';

interface ConnectionBannerProps {
  connectionInfo: ConnectionStatusInfo;
  variant: 'table' | 'lobby';
  onRetryNow?: () => void;
  onReturnHome?: () => void;
}

/**
 * Accessible, non-technical connection status banner shared across Online Lobby,
 * Card Table, and Results screens. Never shows raw tokens or server internals.
 */
export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({
  connectionInfo,
  variant,
  onRetryNow,
  onReturnHome,
}) => {
  const { status, attempt } = connectionInfo;
  if (status === 'connected' || status === 'superseded') return null;

  const isFailed = status === 'failed';
  const isConnecting = status === 'connecting';

  const label = isConnecting
    ? 'Connecting to room...'
    : isFailed
      ? 'Unable to reconnect to the server.'
      : attempt > 1
        ? `Reconnecting to server (attempt ${attempt})...${variant === 'table' ? ' Game continues without pausing.' : ''}`
        : `Reconnecting to server...${variant === 'table' ? ' Game continues without pausing.' : ''}`;

  const containerClasses =
    variant === 'table'
      ? isFailed
        ? 'bg-[#6B1D1D] text-[#FEE2E2] border-b border-[#FCA5A5]/30'
        : isConnecting
          ? 'bg-[#173D25] text-[#E5F4EA] border-b border-white/10'
          : 'bg-[#571C1C] text-[#FDE8E8] border-b border-[#FCA5A5]/25'
      : isFailed
        ? 'rounded-2xl bg-[#FEECE8] text-[#8F2811] border border-[#E59887]'
        : isConnecting
          ? 'rounded-2xl bg-[#EBF5EE] text-[#1E4A2C] border border-[#B2D3BC]'
          : 'rounded-2xl bg-[#FFF6E0] text-[#4A3508] border border-[#E5B84B]';

  const retryButtonClasses =
    variant === 'table'
      ? 'bg-white/18 hover:bg-white/28 text-white'
      : isFailed
        ? 'bg-[#8F2811] hover:bg-[#731F0D] text-white'
        : 'bg-[#3A2B09] hover:bg-[#241A05] text-white';

  const homeButtonClasses =
    variant === 'table'
      ? 'bg-black/25 hover:bg-black/35 text-[#FDE8E8]'
      : 'bg-white/80 hover:bg-white text-[#261E18] border border-[#D8CBB8]';

  return (
    <div
      role={isFailed ? 'alert' : 'status'}
      aria-live="polite"
      className={`px-3.5 py-2 text-xs font-semibold flex flex-wrap items-center justify-center sm:justify-between gap-2 z-20 ${containerClasses}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isConnecting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
        ) : isFailed ? (
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="leading-snug">{label}</span>
      </div>

      {(status === 'reconnecting' || status === 'failed' || status === 'disconnected') && (
        <div className="flex items-center gap-1.5 shrink-0">
          {onRetryNow && (
            <button
              type="button"
              onClick={onRetryNow}
              className={`min-h-[32px] px-3 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${retryButtonClasses}`}
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry Now
            </button>
          )}
          {isFailed && onReturnHome && (
            <button
              type="button"
              onClick={onReturnHome}
              className={`min-h-[32px] px-3 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${homeButtonClasses}`}
            >
              <Home className="w-3 h-3" aria-hidden="true" />
              Home
            </button>
          )}
        </div>
      )}
    </div>
  );
};
