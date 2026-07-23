import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Template } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const CATEGORIES = ["Security", "Network", "Monitoring", "Maintenance", "Other"];
const BLANK = { name: "", description: "", category: "Security", type: "commands", body: "", enabled: true };

function toneOf(cat: string): "primary" | "accent" | "ok" | "muted" | "danger" {
  return ({ Security: "danger", Network: "primary", Monitoring: "accent", Maintenance: "ok" } as const)[cat] ?? "muted";
}

export function Templates() {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.get<Template[]>("/templates").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(tpl: Template) {
    setEditing(tpl);
    setForm({ name: tpl.name, description: tpl.description, category: tpl.category, type: tpl.type, body: tpl.body, enabled: tpl.enabled });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (editing) await api.patch(`/templates/${editing.id}`, form);
      else await api.post("/templates", form);
      setOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(tpl: Template) {
    if (!(await confirm({ title: t("ops:templates.deleteTitle"), message: t("ops:templates.deleteMsg", { name: tpl.name }) }))) return;
    await api.del(`/templates/${tpl.id}`);
    load();
  }

  const lines = (tpl: Template) => tpl.body.split("\n").filter((l) => l.trim()).length;

  return (
    <div>
      <PageHeader title={t("ops:templates.title")} actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> {t("ops:templates.add")}</Button>} />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title={t("ops:templates.emptyTitle")} hint={t("ops:templates.emptyHint")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((tpl) => (
            <Card key={tpl.id} className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="font-semibold leading-tight">{tpl.name}</h3>
                <Badge tone={toneOf(tpl.category)}>{tpl.category}</Badge>
              </div>
              {tpl.description && <p className="mb-2 text-xs text-muted">{tpl.description}</p>}
              <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
                <Badge>{tpl.type === "script" ? t("ops:templates.typeScript") : t("ops:templates.typeCommands")}</Badge>
                <span>{t("ops:templates.lines", { count: lines(tpl) })}</span>
                {!tpl.enabled && <Badge tone="muted">{t("common:labels.disabled")}</Badge>}
              </div>
              <pre className="mb-3 max-h-28 overflow-auto rounded-lg border border-border bg-bg p-2 font-mono text-[11px] text-muted whitespace-pre-wrap">
                {tpl.body || t("ops:shared.emptyParens")}
              </pre>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => openEdit(tpl)}>{t("common:actions.edit")}</Button>
                <Button variant="danger" onClick={() => remove(tpl)}>{t("common:actions.delete")}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {open && (
        <Modal
          title={editing ? t("ops:templates.editTitle") : t("ops:templates.newTitle")}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button onClick={save} disabled={saving || !form.name || !form.body.trim()}>{saving ? t("common:actions.saving") : editing ? t("common:actions.save") : t("common:actions.create")}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label={t("common:labels.name")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("ops:templates.namePlaceholder")} autoFocus /></Field>
            <Field label={t("common:labels.description")}><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("ops:templates.descPlaceholder")} /></Field>
            <Field label={t("ops:templates.category")}>
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label={t("common:labels.type")}>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.type === "commands"} onChange={() => setForm({ ...form, type: "commands" })} /> {t("ops:templates.typeCommandsRadio")}
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.type === "script"} onChange={() => setForm({ ...form, type: "script" })} /> {t("ops:templates.typeScriptRadio")}
                </label>
              </div>
            </Field>
            <Field label={form.type === "script" ? t("ops:templates.bodyScriptLabel") : t("ops:templates.bodyCommandsLabel")}>
              <Textarea
                rows={7}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="font-mono text-xs"
                placeholder={"/ip/service/disable telnet\n/ip/service/disable ftp"}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {t("common:labels.enabled")}
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}
