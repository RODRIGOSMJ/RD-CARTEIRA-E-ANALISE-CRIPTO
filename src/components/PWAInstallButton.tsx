import { Check, Copy, Download, Laptop, Share, Smartphone, Tablet, X } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (isInstalled) {
    return null;
  }

  const appUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://rd-carteira-e-analise-cripto.vercel.app';

  async function handleAction() {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  }

  async function handleCopyAppUrl() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleAction()}
        title="Baixar aplicativo para celular, tablet ou computador"
        aria-label="Baixar aplicativo"
        className="h-8 inline-flex items-center gap-1.5 px-2.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
        <span className="hidden sm:inline">Baixar app</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/[0.08]">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="SinalCripto IA"
                  className="w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 shrink-0"
                />
                <div>
                  <h2 id="pwa-install-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Instalar SinalCripto IA
                  </h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Use como aplicativo no celular, tablet ou computador
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700 dark:text-slate-300">
              {isInstallable && (
                <button
                  type="button"
                  onClick={() => void install()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Instalar aplicativo neste dispositivo agora
                </button>
              )}

              <div className="space-y-3">
                <div
                  className={`rounded-lg border p-3.5 space-y-1.5 ${
                    isIOS
                      ? 'border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10'
                      : 'border-slate-200 bg-slate-50 dark:border-white/[0.08] dark:bg-[#0B0F17]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Tablet className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>iPad e iPhone (Safari)</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                    <li>
                      Abra este endereço no <strong className="text-slate-900 dark:text-slate-100">Safari</strong>.
                    </li>
                    <li>
                      Toque no ícone <strong className="text-slate-900 dark:text-slate-100 inline-flex items-center gap-1">Compartilhar <Share className="w-3 h-3 inline text-sky-600 dark:text-sky-400" /></strong> na barra do navegador.
                    </li>
                    <li>
                      Toque em <strong className="text-slate-900 dark:text-slate-100">Adicionar à Tela de Início</strong> e depois em <strong className="text-slate-900 dark:text-slate-100">Adicionar</strong>.
                    </li>
                  </ol>
                </div>

                <div
                  className={`rounded-lg border p-3.5 space-y-1.5 ${
                    isAndroid
                      ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10'
                      : 'border-slate-200 bg-slate-50 dark:border-white/[0.08] dark:bg-[#0B0F17]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Celular e Tablet Android (Chrome)</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                    <li>
                      Abra no <strong className="text-slate-900 dark:text-slate-100">Google Chrome</strong> e toque no menu <strong className="text-slate-900 dark:text-slate-100">⋮</strong> (canto superior direito).
                    </li>
                    <li>
                      Toque em <strong className="text-slate-900 dark:text-slate-100">Instalar aplicativo</strong> ou <strong className="text-slate-900 dark:text-slate-100">Adicionar à tela inicial</strong>.
                    </li>
                  </ol>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-white/[0.08] dark:bg-[#0B0F17] p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Laptop className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                    <span>Computador (Windows, Mac ou Linux)</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    No <strong className="text-slate-900 dark:text-slate-100">Chrome</strong> ou <strong className="text-slate-900 dark:text-slate-100">Edge</strong>, clique no ícone de instalação{' '}
                    <strong className="text-slate-900 dark:text-slate-100">Instalar SinalCripto IA</strong> no canto direito da barra de endereços (ou no menu ⋮ → Salvar e compartilhar).
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#0B0F17] px-3 py-2.5 flex items-center gap-2">
                <code className="text-[11px] font-mono text-sky-700 dark:text-sky-300 truncate flex-1">
                  {appUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyAppUrl()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copiar link
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
