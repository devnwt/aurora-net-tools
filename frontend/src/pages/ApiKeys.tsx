import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ApiKeyCreated, ApiKeyMeta } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

export function ApiKeys() {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const [items, setItems] = useState<ApiKeyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    setLoading(true);
    api.get<ApiKeyMeta[]>("/apikeys").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create() {
    setSaving(true);
    setErr("");
    try {
      const k = await api.post<ApiKeyCreated>("/apikeys", { name });
      setOpen(false);
      setName("");
      setCreated(k);
      setCopied(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(k: ApiKeyMeta) {
    if (!(await confirm({ title: t("access:apikeys.revokeConfirm.title"), message: t("access:apikeys.revokeConfirm.message", { name: k.name }) }))) return;
    await api.del(`/apikeys/${k.id}`);
    load();
  }

  async function copy(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
  }

  return (
    <div>
      <PageHeader
        title={t("access:apikeys.title")}
        subtitle={t("access:apikeys.subtitle")}
        actions={<Button onClick={() => { setName(""); setErr(""); setOpen(true); }}><Plus className="h-4 w-4" /> {t("access:apikeys.create")}</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title={t("access:apikeys.empty.title")} hint={t("access:apikeys.empty.hint")} />
      ) : (
        <Table head={<><Th>{t("common:labels.name")}</Th><Th>{t("access:apikeys.columns.prefix")}</Th><Th>{t("access:apikeys.columns.created")}</Th><Th>{t("access:apikeys.columns.lastUsed")}</Th><Th className="text-right">{t("common:labels.actions")}</Th></>}>
          {items.map((k) => (
            <tr key={k.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{k.name}</Td>
              <Td className="font-mono text-muted">{k.prefix}…</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{new Date(k.created_at).toLocaleString("pt-BR")}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString("pt-BR") : t("access:apikeys.never")}</Td>
              <Td className="text-right"><Button variant="danger" onClick={() => remove(k)}>{t("access:apikeys.revoke")}</Button></Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={t("access:apikeys.createTitle")}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button onClick={create} disabled={saving || !name}>{saving ? t("access:apikeys.creating") : t("common:actions.create")}</Button>
            </>
          }
        >
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-muted">{t("common:labels.name")}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("access:apikeys.namePlaceholder")} autoFocus />
            {err && <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">{err}</p>}
          </div>
        </Modal>
      )}

      {created && (
        <Modal title={t("access:apikeys.createdTitle")} onClose={() => setCreated(null)}>
          <p className="mb-3 text-sm text-muted">
            {t("access:apikeys.createdWarn.before")}<strong className="text-text">{t("access:apikeys.createdWarn.strong")}</strong>{t("access:apikeys.createdWarn.after")}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs">{created.token}</code>
            <Button onClick={() => copy(created.token)}><Copy className="h-4 w-4" /> {copied ? t("common:actions.copied") : t("common:actions.copy")}</Button>
          </div>
          <p className="mt-3 text-xs text-muted">{t("access:apikeys.useHeader")} <span className="font-mono">X-API-Key: {created.prefix}…</span></p>
        </Modal>
      )}
    </div>
  );
}
