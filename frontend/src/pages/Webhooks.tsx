import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Webhook } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const EVENTS = [
  { key: "device.online", labelKey: "access:webhooks.events.online" },
  { key: "device.offline", labelKey: "access:webhooks.events.offline" },
];

const BLANK = { name: "", url: "", events: "", secret: "", enabled: true };

export function Webhooks() {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [tested, setTested] = useState<Record<number, string>>({});

  function load() {
    setLoading(true);
    api.get<Webhook[]>("/webhooks").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setErr("");
    setOpen(true);
  }
  function openEdit(w: Webhook) {
    setEditing(w);
    setForm({ name: w.name, url: w.url, events: w.events, secret: "", enabled: w.enabled });
    setErr("");
    setOpen(true);
  }

  const selected = new Set(form.events.split(",").map((e) => e.trim()).filter(Boolean));
  function toggleEvent(k: string) {
    const s = new Set(selected);
    s.has(k) ? s.delete(k) : s.add(k);
    setForm({ ...form, events: [...s].join(",") });
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      if (editing) {
        const body: Record<string, unknown> = { name: form.name, url: form.url, events: form.events, enabled: form.enabled };
        if (form.secret) body.secret = form.secret;
        await api.patch(`/webhooks/${editing.id}`, body);
      } else {
        await api.post("/webhooks", form);
      }
      setOpen(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function test(w: Webhook) {
    setTested((prev) => ({ ...prev, [w.id]: "…" }));
    try {
      const r = await api.post<{ ok: boolean; status: number }>(`/webhooks/${w.id}/test`);
      setTested((prev) => ({ ...prev, [w.id]: r.ok ? t("access:webhooks.test.delivered", { status: r.status }) : t("access:webhooks.test.response", { status: r.status }) }));
    } catch (e) {
      setTested((prev) => ({ ...prev, [w.id]: e instanceof ApiError ? t("access:webhooks.test.error", { status: e.status }) : t("access:webhooks.test.failed") }));
    }
  }

  async function remove(w: Webhook) {
    if (!(await confirm({ title: t("access:webhooks.delete.title"), message: t("access:webhooks.delete.message", { name: w.name }) }))) return;
    await api.del(`/webhooks/${w.id}`);
    load();
  }

  return (
    <div>
      <PageHeader
        title={t("access:webhooks.title")}
        subtitle={t("access:webhooks.subtitle")}
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> {t("access:webhooks.add")}</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title={t("access:webhooks.empty.title")} hint={t("access:webhooks.empty.hint")} />
      ) : (
        <Table head={<><Th>{t("common:labels.name")}</Th><Th>{t("access:webhooks.columns.url")}</Th><Th>{t("access:webhooks.columns.events")}</Th><Th>{t("common:labels.status")}</Th><Th className="text-right">{t("common:labels.actions")}</Th></>}>
          {items.map((w) => (
            <tr key={w.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{w.name} {w.has_secret && <Badge tone="muted">{t("access:webhooks.signed")}</Badge>}</Td>
              <Td className="max-w-xs truncate font-mono text-xs text-muted" title={w.url}>{w.url}</Td>
              <Td className="text-xs text-muted">{w.events || t("access:webhooks.allEvents")}</Td>
              <Td>{w.enabled ? <Badge tone="ok">{t("access:webhooks.active")}</Badge> : <Badge tone="muted">{t("access:webhooks.inactive")}</Badge>}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {tested[w.id] && <span className="text-xs text-muted">{tested[w.id]}</span>}
                  <Button variant="ghost" onClick={() => test(w)}>{t("common:actions.test")}</Button>
                  <Button variant="ghost" onClick={() => openEdit(w)}>{t("common:actions.edit")}</Button>
                  <Button variant="danger" onClick={() => remove(w)}>{t("common:actions.delete")}</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? t("access:webhooks.editTitle") : t("access:webhooks.add")}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button onClick={save} disabled={saving || !form.name || !form.url}>{saving ? t("common:actions.saving") : editing ? t("common:actions.save") : t("common:actions.create")}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Fld label={t("common:labels.name")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Fld>
            <Fld label={t("access:webhooks.urlLabel")}><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={t("access:webhooks.urlPlaceholder")} className="font-mono" /></Fld>
            <Fld label={t("access:webhooks.eventsLabel")}>
              <div className="flex flex-col gap-1">
                {EVENTS.map((ev) => (
                  <label key={ev.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={selected.has(ev.key)} onChange={() => toggleEvent(ev.key)} /> {t(ev.labelKey)}
                  </label>
                ))}
              </div>
            </Fld>
            <Fld label={editing ? t("access:webhooks.secretLabelEdit") : t("access:webhooks.secretLabelNew")}>
              <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder={t("access:webhooks.secretPlaceholder")} className="font-mono" />
            </Fld>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {t("common:labels.enabled")}
            </label>
            {err && <p className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}
