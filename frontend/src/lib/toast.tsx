// Toasts no canto superior direito — feedback não-bloqueante para erros e
// ações concluídas.
//
// Complementa o useConfirm(): o diálogo interrompe o fluxo e exige resposta;
// o toast só informa. Use o diálogo quando a pessoa PRECISA decidir algo,
// e o toast para o resto.
//
// Uso:
//   const toast = useToast();
//   toast.success("Device salvo.");
//   try { ... } catch (e) { toast.error(e); }        // extrai msg de ApiError/Error
//   toast.error("Falhou", { title: "Backup", duration: 0 });  // 0 = não some sozinho
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import i18n from "@/i18n";

type Variant = "error" | "success" | "warning" | "info";

interface ToastOptions {
  title?: string;
  /** 0 mantém o toast até ser fechado à mão. */
  duration?: number;
}

interface Toast extends ToastOptions {
  id: number;
  variant: Variant;
  message: ReactNode;
  duration: number;
  /** Chave de deduplicação: mesma variante + mesma mensagem. */
  key: string;
  /** Quantas vezes esta mesma mensagem repetiu (vira o badge "×N"). */
  count: number;
  leaving?: boolean;
}

interface ToastCtx {
  error: (e: unknown, opts?: ToastOptions) => void;
  success: (message: ReactNode, opts?: ToastOptions) => void;
  warning: (message: ReactNode, opts?: ToastOptions) => void;
  info: (message: ReactNode, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
  clear: () => void;
}

const Ctx = createContext<ToastCtx | null>(null);

// Erro dura mais: costuma trazer texto para ler, e some antes de ser lido irrita.
const DEFAULT_DURATION: Record<Variant, number> = {
  error: 8000,
  warning: 6000,
  success: 4000,
  info: 5000,
};

/** Teto de toasts visíveis — sem isso um poller falhando cobre a tela inteira. */
const MAX_VISIBLE = 4;
/** Tempo da animação de saída antes de remover do DOM. */
const EXIT_MS = 180;

let nextId = 1;

/** Extrai texto legível de qualquer coisa que caia num catch. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return i18n.t("common:state.unexpectedError");
}

const STYLES: Record<Variant, { icon: typeof Info; bar: string; fg: string }> = {
  error: { icon: XCircle, bar: "bg-danger", fg: "text-danger" },
  success: { icon: CheckCircle2, bar: "bg-ok", fg: "text-ok" },
  warning: { icon: AlertTriangle, bar: "bg-accent", fg: "text-accent" },
  info: { icon: Info, bar: "bg-primary", fg: "text-primary" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Marca como "saindo" e só remove depois da animação — remover direto faria
  // o toast sumir num piscar, e os de baixo saltarem para cima.
  const dismiss = useCallback(
    (id: number) => {
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => remove(id), EXIT_MS);
    },
    [remove],
  );

  const clear = useCallback(() => setItems([]), []);

  const show = useCallback((variant: Variant, message: ReactNode, opts?: ToastOptions) => {
    const key = `${variant}:${typeof message === "string" ? message : ""}`;
    const duration = opts?.duration ?? DEFAULT_DURATION[variant];

    setItems((prev) => {
      // Mesma mensagem repetida (retry, poller, SSE caindo) vira contador em vez
      // de empilhar cópias idênticas. Só deduplica string — ReactNode não dá
      // para comparar de forma confiável.
      const i = typeof message === "string" ? prev.findIndex((t) => t.key === key && !t.leaving) : -1;
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], count: next[i].count + 1 };
        return next;
      }
      const toast: Toast = {
        id: nextId++,
        variant,
        message,
        duration,
        title: opts?.title,
        key,
        count: 1,
      };
      // Mais novo no topo; o excedente cai fora pelo fim da lista.
      return [toast, ...prev].slice(0, MAX_VISIBLE);
    });
  }, []);

  // Memoizado: sem isso o value muda a cada render do provider e TODO componente
  // que chama useToast() re-renderiza a cada toast exibido ou fechado.
  const value = useMemo<ToastCtx>(
    () => ({
      error: (e, opts) => {
        // Bloqueio de plano (SEM PLANO): o popup infechável já cobre a tela — não
        // polui com toast de "falha ao carregar" em cada request barrado.
        if (e instanceof ApiError && e.code === "plan_required") return;
        show("error", errorMessage(e), opts);
      },
      success: (m, opts) => show("success", m, opts),
      warning: (m, opts) => show("warning", m, opts),
      info: (m, opts) => show("info", m, opts),
      dismiss,
      clear,
    }),
    [show, dismiss, clear],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* z-[60] fica acima do Modal (z-50) — um erro disparado de dentro de um
          diálogo precisa aparecer. pointer-events-none no container para a
          coluna vazia não capturar cliques da página.
          top-20 e não top-4: o canto superior direito é onde o PageHeader põe a
          ação primária de toda página ("Atualizar Tudo", "Novo device"). Em
          top-4 o toast de erro cobria justamente o botão que a mensagem manda
          apertar. 80px passa da faixa do header (~74px no pior caso, com
          subtítulo) sem deixar de ser o canto superior. */}
      <div
        className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
        role="region"
        aria-label={i18n.t("common:a11y.notifications")}
      >
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { icon: Icon, bar, fg } = STYLES[toast.variant];
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);

  // Anima a entrada: monta deslocado/transparente e só então aplica o estado
  // final, para o browser ter dois frames distintos para interpolar.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Repetiu (count subiu) → renova o tempo: a informação chegou agora de novo.
  // Declarado ANTES do timer: o React roda todos os cleanups e só depois os
  // efeitos, então este reset acontece entre o clearTimeout e o novo setTimeout.
  useEffect(() => {
    remaining.current = toast.duration;
  }, [toast.count, toast.duration]);

  useEffect(() => {
    if (toast.duration <= 0 || paused || toast.leaving) return;
    const started = Date.now();
    const id = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(id);
      // Desconta o que já correu para o hover PAUSAR, e não reiniciar do zero.
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, toast.duration, toast.id, toast.count, toast.leaving, onDismiss]);

  const leaving = toast.leaving || !visible;

  return (
    <div
      // Erro interrompe a leitura (assertive); o resto espera a pausa natural.
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex overflow-hidden rounded-lg border border-border bg-surface shadow-xl transition-all duration-200",
        leaving ? "translate-x-2 opacity-0" : "translate-x-0 opacity-100",
      )}
    >
      <div className={cn("w-1 shrink-0", bar)} aria-hidden />
      <div className="flex flex-1 items-start gap-3 p-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", fg)} aria-hidden />
        <div className="min-w-0 flex-1">
          {toast.title && <p className="text-sm font-semibold leading-tight">{toast.title}</p>}
          {/* break-words + max-h: o detail da API pode vir longo (JSON), e sem
              isso o toast estoura a largura ou vira uma parede de texto. */}
          <div
            className={cn(
              "max-h-40 overflow-y-auto whitespace-pre-line break-words text-sm leading-relaxed text-muted",
              toast.title && "mt-0.5",
            )}
          >
            {toast.message}
          </div>
        </div>
        {toast.count > 1 && (
          <span
            className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums", fg, "bg-surface-2")}
            aria-label={i18n.t("common:a11y.repeated", { count: toast.count })}
          >
            ×{toast.count}
          </span>
        )}
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label={i18n.t("common:a11y.closeNotification")}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast precisa do <ToastProvider> na árvore.");
  return ctx;
}
