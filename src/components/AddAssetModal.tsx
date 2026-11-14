import { Loader2, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SearchResult {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
}

interface AddAssetModalProps {
  open: boolean;
  existingIds: Set<string>;
  onClose: () => void;
  onAdd: (coin: { id: string; symbol: string; name: string }) => Promise<void>;
}

export function AddAssetModal({
  open,
  existingIds,
  onClose,
  onAdd,
}: AddAssetModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setError(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { results?: SearchResult[] };
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 320);

    return () => clearTimeout(handle);
  }, [query]);

  if (!open) return null;

  async function handleSelect(coin: { id: string; symbol: string; name: string }) {
    setError(null);
    setAddingId(coin.id);
    try {
      await onAdd(coin);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível adicionar o ativo.');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-asset-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#111827] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div>
            <h2 id="add-asset-title" className="text-base font-semibold text-slate-100">
              Adicionar criptomoeda ao monitoramento
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              A IA iniciará o estudo automático assim que o ativo for incluído.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
            aria-label="Fechar janela"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite o nome ou ticker da criptomoeda..."
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-white/10 bg-[#0B0F17] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
            {searching && (
              <Loader2 className="w-4 h-4 text-sky-400 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
            )}
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {query.trim().length >= 2 ? (
            <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.06] border border-white/[0.07] rounded-lg bg-[#0B0F17]">
              {results.length === 0 && !searching ? (
                <p className="p-4 text-xs text-slate-400 text-center">
                  Nenhum ativo encontrado para &quot;{query}&quot;.
                </p>
              ) : (
                results.map((coin) => {
                  const alreadyAdded = existingIds.has(coin.id);
                  const busy = addingId === coin.id;
                  return (
                    <div
                      key={coin.id}
                      className="flex items-center justify-between px-3.5 py-2.5 hover:bg-white/[0.02]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-100 font-mono">
                            {coin.symbol}
                          </span>
                          <span className="text-xs text-slate-300 truncate">
                            {coin.name}
                          </span>
                        </div>
                        {coin.marketCapRank && (
                          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                            Rank #{coin.marketCapRank}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={alreadyAdded || busy}
                        onClick={() => handleSelect(coin)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          alreadyAdded
                            ? 'text-slate-500 bg-slate-800/60 cursor-not-allowed'
                            : 'bg-sky-600 hover:bg-sky-500 text-white'
                        }`}
                      >
                        {busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        {alreadyAdded ? 'Monitorando' : 'Adicionar'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-white/[0.07] bg-[#0B0F17] p-4 text-xs text-slate-400 leading-relaxed">
              Digite pelo menos 2 caracteres acima para pesquisar qualquer criptomoeda oficial em tempo real e adicioná-la ao seu painel de monitoramento.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
