import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-[#111827]/95 backdrop-blur-md px-3.5 py-2 text-xs font-medium text-amber-200 shadow-xl">
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>Modo offline — exibindo dados salvos em cache.</span>
    </div>
  );
}
