/**
 * Switch ON/OFF que pede confirmação antes de efetivar a mudança.
 *
 * O estado é controlado pelo dado (checked); só muda depois que a ação assíncrona
 * conclui com sucesso — então cancelar mantém o switch como estava, sem reverter
 * manualmente. Durante a requisição fica em loading e ignora novos cliques.
 *
 * Reaproveita o Toggle (ui) e o diálogo useConfirm existentes.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Toggle } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

export function ConfirmSwitch({ checked, disabled, ariaLabel, confirmTitle, confirmMessage, onToggle }: {
  checked: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  /** Título/mensagem por direção (ativar = true, desativar = false). */
  confirmTitle: (next: boolean) => string;
  confirmMessage: (next: boolean) => string;
  /** Executa a mudança (chamada de API). Lança em erro → o switch não muda. */
  onToggle: (next: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);

  async function handle(next: boolean) {
    const ok = await confirm({
      title: confirmTitle(next),
      message: confirmMessage(next),
      tone: next ? "primary" : "danger",
      confirmText: t("common:actions.confirm"),
      cancelText: t("common:actions.cancel"),
    });
    if (!ok) return; // cancelou → switch permanece no estado atual (controlado pelo dado)
    setBusy(true);
    try {
      await onToggle(next);
    } catch {
      // Erro tratado pelo chamador (toast/alert); o dado não muda, então o switch volta ao estado anterior.
    } finally {
      setBusy(false);
    }
  }

  return <Toggle checked={checked} onChange={handle} disabled={disabled} busy={busy} ariaLabel={ariaLabel} />;
}
