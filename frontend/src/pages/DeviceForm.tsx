import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Credential, CredentialKind, Device, Group } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card, Input, Select } from "@/components/ui";
import { maskIPv4, maskPort } from "@/lib/masks";
import { cn, isIPv4 } from "@/lib/utils";

type FormState = {
  name: string;
  ip: string;
  device_type: string;
  group_id: number | null;
  ssh_enabled: boolean;
  ssh_port: number;
  ssh_credential_id: number | null;
  telnet_enabled: boolean;
  telnet_port: number;
  telnet_credential_id: number | null;
  snmp_enabled: boolean;
  snmp_port: number;
  snmp_credential_id: number | null;
  api_enabled: boolean;
  api_base_url: string;
  api_credential_id: number | null;
  notes: string;
  latitude: number | null;
  longitude: number | null;
};

const EMPTY: FormState = {
  name: "",
  ip: "",
  device_type: "routeros",
  group_id: null,
  ssh_enabled: false,
  ssh_port: 22,
  ssh_credential_id: null,
  telnet_enabled: false,
  telnet_port: 23,
  telnet_credential_id: null,
  snmp_enabled: false,
  snmp_port: 161,
  snmp_credential_id: null,
  api_enabled: false,
  api_base_url: "",
  api_credential_id: null,
  notes: "",
  latitude: null,
  longitude: null,
};

export function DeviceForm() {
  const { t } = useTranslation();
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [groups, setGroups] = useState<Group[]>([]);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ipFocused, setIpFocused] = useState(false);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Enquanto digita: só dígitos e pontos, no máximo 12 dígitos (4 octetos × 3).
  // Não insere ponto nem valida agora — isso acontece ao sair do campo (onBlur).
  function onIpType(raw: string) {
    let out = "";
    let digits = 0;
    for (const ch of raw) {
      if (ch >= "0" && ch <= "9") {
        if (digits >= 12) continue;
        digits++;
        out += ch;
      } else if (ch === ".") {
        out += ch;
      }
    }
    set("ip", out);
  }

  // Ao terminar de digitar: acrescenta os pontos (formata o IPv4) e destrava a validação.
  function onIpDone() {
    setIpFocused(false);
    set("ip", maskIPv4(form.ip));
  }

  useEffect(() => {
    api.get<Group[]>("/groups").then(setGroups);
    api.get<Credential[]>("/credentials").then(setCreds);
    if (editing) {
      api.get<Device>(`/devices/${id}`).then((d) => setForm({ ...EMPTY, ...d } as FormState));
    }
  }, [id, editing]);

  // Validação só APÓS terminar de digitar (campo sem foco). O back-end continua
  // sendo a fonte de verdade (formato inválido e IP duplicado na ORG voltam de lá).
  const ipInvalid = !ipFocused && form.ip.trim() !== "" && !isIPv4(form.ip);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Garante a formatação mesmo se o usuário salvar sem sair do campo.
    const ip = maskIPv4(form.ip);
    if (ip !== form.ip) set("ip", ip);
    if (!isIPv4(ip)) {
      setIpFocused(false);
      setError(t("devices:form.ipInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editing) await api.patch(`/devices/${id}`, { ...form, ip });
      else await api.post("/devices", { ...form, ip });
      nav("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text cursor-pointer">
        <ArrowLeft className="h-4 w-4" /> {t("devices:form.inventory")}
      </Link>
      <PageHeader title={editing ? t("devices:form.editTitle") : t("devices:form.newTitle")} />

      <form onSubmit={submit} className="max-w-3xl space-y-5">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common:labels.name")}>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </Field>
            <Field label={t("devices:form.ipHost")}>
              <Input
                value={form.ip}
                onChange={(e) => onIpType(e.target.value)}
                onFocus={() => setIpFocused(true)}
                onBlur={onIpDone}
                className={cn("font-mono", ipInvalid && "border-danger focus:border-danger")}
                placeholder="192.168.0.1"
                inputMode="numeric"
                aria-invalid={ipInvalid}
                required
              />
              {ipInvalid && <span className="mt-1 block text-xs text-danger">{t("devices:form.ipInvalid")}</span>}
            </Field>
            <Field label={t("common:labels.type")}>
              <Select value={form.device_type} onChange={(e) => set("device_type", e.target.value)}>
                <option value="routeros">RouterOS</option>
                <option value="cisco">Cisco</option>
                <option value="huawei">Huawei</option>
              </Select>
            </Field>
            <Field label={t("devices:form.group")}>
              <Select
                value={form.group_id ?? ""}
                onChange={(e) => set("group_id", e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{t("devices:form.noGroup")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("devices:form.latitude")}>
              <Input type="number" step="any" value={form.latitude ?? ""} onChange={(e) => set("latitude", e.target.value ? Number(e.target.value) : null)} placeholder="-20.1234" className="font-mono" />
            </Field>
            <Field label={t("devices:form.longitude")}>
              <Input type="number" step="any" value={form.longitude ?? ""} onChange={(e) => set("longitude", e.target.value ? Number(e.target.value) : null)} placeholder="-40.1234" className="font-mono" />
            </Field>
          </div>
        </Card>

        <AccessSection
          title="SSH"
          enabled={form.ssh_enabled}
          onToggle={(v) => set("ssh_enabled", v)}
          port={form.ssh_port}
          onPort={(v) => set("ssh_port", v)}
          credId={form.ssh_credential_id}
          onCred={(v) => set("ssh_credential_id", v)}
          creds={creds}
          kind="ssh"
        />
        <AccessSection
          title="Telnet"
          enabled={form.telnet_enabled}
          onToggle={(v) => set("telnet_enabled", v)}
          port={form.telnet_port}
          onPort={(v) => set("telnet_port", v)}
          credId={form.telnet_credential_id}
          onCred={(v) => set("telnet_credential_id", v)}
          creds={creds}
          kind="telnet"
        />
        <AccessSection
          title="SNMP"
          enabled={form.snmp_enabled}
          onToggle={(v) => set("snmp_enabled", v)}
          port={form.snmp_port}
          onPort={(v) => set("snmp_port", v)}
          credId={form.snmp_credential_id}
          onCred={(v) => set("snmp_credential_id", v)}
          creds={creds}
          kind="snmp"
        />

        <Card>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.api_enabled}
              onChange={(e) => set("api_enabled", e.target.checked)}
            />
            API <span className="text-xs font-normal text-muted">{t("devices:form.apiNote")}</span>
          </label>
          {form.api_enabled && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label={t("devices:form.baseUrl")}>
                <Input value={form.api_base_url} onChange={(e) => set("api_base_url", e.target.value)} className="font-mono" />
              </Field>
              <Field label={t("devices:form.credential")}>
                <CredSelect creds={creds} kind="api" value={form.api_credential_id} onChange={(v) => set("api_credential_id", v)} />
              </Field>
            </div>
          )}
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || ipInvalid}>{busy ? t("common:actions.saving") : editing ? t("common:actions.save") : t("devices:form.submitCreate")}</Button>
          <Button type="button" variant="ghost" onClick={() => nav("/")}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function CredSelect({
  creds,
  kind,
  value,
  onChange,
}: {
  creds: Credential[];
  kind: CredentialKind;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const { t } = useTranslation();
  const options = creds.filter((c) => c.kind === kind);
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{t("devices:form.inheritFromGroup")}</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </Select>
  );
}

function AccessSection({
  title,
  enabled,
  onToggle,
  port,
  onPort,
  credId,
  onCred,
  creds,
  kind,
}: {
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  port: number;
  onPort: (v: number) => void;
  credId: number | null;
  onCred: (v: number | null) => void;
  creds: Credential[];
  kind: CredentialKind;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-primary"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {title}
      </label>
      {enabled && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label={t("common:labels.port")}>
            {/* Estado numérico: mascara para dígitos/teto 65535 e converte de volta. */}
            <Input
              inputMode="numeric"
              value={port === 0 ? "" : String(port)}
              onChange={(e) => onPort(Number(maskPort(e.target.value) || 0))}
              className="font-mono"
            />
          </Field>
          <Field label={t("devices:form.credential")}>
            <CredSelect creds={creds} kind={kind} value={credId} onChange={onCred} />
          </Field>
        </div>
      )}
    </Card>
  );
}
