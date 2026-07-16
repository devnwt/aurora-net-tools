// Diálogo de confirmação/alerta com as cores do sistema (substitui confirm()/alert()).
//
// Uso:
//   const { confirm, alert } = useConfirm();
//   if (!(await confirm({ title: "Excluir", message: "..." }))) return;
//   await alert({ title: "Erro", message: "...", tone: "danger" });
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import { AlertTriangle, Info } from "lucide-react";

type Tone = "danger" | "primary";

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone; // cor do botão de ação (default: danger)
}

interface AlertOptions {
  title?: string;
  message: ReactNode;
  okText?: string;
  tone?: Tone; // default: danger (usado para erros)
}

interface ConfirmCtx {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
}

const Ctx = createContext<ConfirmCtx | null>(null);

type State =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | null;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })),
    [],
  );
  const alert = useCallback(
    (opts: AlertOptions) => new Promise<void>((resolve) => setState({ kind: "alert", opts, resolve })),
    [],
  );

  function done(result: boolean) {
    setState((s) => {
      if (s?.kind === "confirm") s.resolve(result);
      else if (s?.kind === "alert") s.resolve();
      return null;
    });
  }

  const tone: Tone = state?.opts.tone ?? "danger";
  const Icon = tone === "danger" ? AlertTriangle : Info;
  const iconColor = tone === "danger" ? "text-danger" : "text-primary";
  const actionClass =
    tone === "danger"
      ? "border border-danger bg-danger text-white hover:bg-danger/90"
      : "border border-primary bg-primary text-primary-fg hover:bg-primary/90";

  return (
    <Ctx.Provider value={{ confirm, alert }}>
      {children}
      {state && (
        <Modal
          title={state.opts.title ?? (state.kind === "confirm" ? "Confirmar ação" : "Aviso")}
          onClose={() => done(false)}
          footer={
            state.kind === "confirm" ? (
              <>
                <Button variant="ghost" onClick={() => done(false)}>
                  {(state.opts as ConfirmOptions).cancelText ?? "Cancelar"}
                </Button>
                <Button onClick={() => done(true)} className={actionClass}>
                  {(state.opts as ConfirmOptions).confirmText ?? "Excluir"}
                </Button>
              </>
            ) : (
              <Button onClick={() => done(true)} className={actionClass}>
                {(state.opts as AlertOptions).okText ?? "OK"}
              </Button>
            )
          }
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 shrink-0 ${iconColor}`}>
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <div className="whitespace-pre-line text-sm leading-relaxed text-muted">{state.opts.message}</div>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm precisa do <ConfirmProvider> na árvore.");
  return ctx;
}
