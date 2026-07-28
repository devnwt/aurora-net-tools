import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Device, Group } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";
import { MaskedInput } from "@/components/MaskedInput";
import { useConfirm } from "@/lib/confirm";
import { DeviceMap } from "@/components/DeviceMap";

const BLANK = { name: "", location: "", description: "", latitude: "", longitude: "" };

export function Sites() {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api.get<Group[]>("/groups"), api.get<Device[]>("/devices")])
      .then(([g, d]) => {
        setGroups(g);
        setDevices(d);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const d of devices) if (d.group_id != null) c[d.group_id] = (c[d.group_id] ?? 0) + 1;
    return c;
  }, [devices]);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(g: Group) {
    setEditing(g);
    setForm({ name: g.name, location: g.location ?? "", description: g.description ?? "", latitude: g.latitude != null ? String(g.latitude) : "", longitude: g.longitude != null ? String(g.longitude) : "" });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        location: form.location,
        description: form.description,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
      };
      if (editing) await api.patch(`/groups/${editing.id}`, payload);
      else await api.post("/groups", payload);
      setOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: Group) {
    if (!(await confirm({ title: t("sites:delete.title"), message: t("sites:delete.message", { name: g.name }) }))) return;
    await api.del(`/groups/${g.id}`);
    load();
  }

  return (
    <div>
      <PageHeader
        title={t("sites:title")}
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> {t("sites:addSite")}</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : groups.length === 0 ? (
        <EmptyState title={t("sites:empty.title")} hint={t("sites:empty.hint")} />
      ) : (
        <Table head={<><Th>{t("common:labels.name")}</Th><Th>{t("sites:columns.location")}</Th><Th>{t("common:labels.description")}</Th><Th>{t("sites:columns.devices")}</Th><Th className="text-right">{t("common:labels.actions")}</Th></>}>
          {groups.map((g) => (
            <tr key={g.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{g.name}</Td>
              <Td className="text-muted">{g.location || "—"}</Td>
              <Td className="text-muted">{g.description || "—"}</Td>
              <Td className="font-mono">{counts[g.id] ?? 0}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => openEdit(g)}>{t("common:actions.edit")}</Button>
                  <Button variant="danger" onClick={() => remove(g)}>{t("common:actions.delete")}</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? t("sites:editSite") : t("sites:addSite")}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button onClick={save} disabled={saving || !form.name}>{saving ? t("common:actions.saving") : editing ? t("common:actions.save") : t("sites:addSite")}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label={t("common:labels.name")}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t("sites:columns.location")}>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("sites:placeholders.location")} />
            </Field>
            <Field label={t("common:labels.description")}>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("sites:placeholders.description")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("sites:fields.latitude")}>
                <MaskedInput mask="coordinate" value={form.latitude} onValueChange={(v) => setForm({ ...form, latitude: v })} placeholder={t("sites:placeholders.latitude")} className="font-mono" />
              </Field>
              <Field label={t("sites:fields.longitude")}>
                <MaskedInput mask="coordinate" value={form.longitude} onValueChange={(v) => setForm({ ...form, longitude: v })} placeholder={t("sites:placeholders.longitude")} className="font-mono" />
              </Field>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <DeviceMap
                key={editing?.id ?? "new"}
                lat={form.latitude ? Number(form.latitude) : null}
                lon={form.longitude ? Number(form.longitude) : null}
                label={form.name || undefined}
                height={200}
                onPick={(la, lo) => setForm((f) => ({ ...f, latitude: la.toFixed(6), longitude: lo.toFixed(6) }))}
              />
              <p className="px-3 py-1.5 text-[11px] text-muted">{t("sites:mapHint")}</p>
            </div>
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
