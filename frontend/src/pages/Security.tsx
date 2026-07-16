import { useEffect, useState } from "react";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { rosGet } from "@/lib/rosClient";
import type { Device, SecurityResp } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Card, EmptyState, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));

const SEV = {
  ok: { icon: CheckCircle2, color: "text-ok", ring: "border-ok/40", label: "OK" },
  warn: { icon: ShieldAlert, color: "text-accent", ring: "border-accent/40", label: "Atenção" },
  fail: { icon: XCircle, color: "text-danger", ring: "border-danger/40", label: "Falha" },
} as const;

export function Security() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [target, setTarget] = useState("");
  const [data, setData] = useState<SecurityResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<Device[]>("/devices").then((d) => setDevices(d.filter((x) => x.device_type === "routeros")));
  }, []);

  async function run(id: string) {
    if (!id) return;
    setBusy(true);
    setErr("");
    setData(null);
    try {
      setData(await rosGet<SecurityResp>(Number(id), "/security"));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Security" subtitle="Checagens de hardening do RouterOS" />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              run(e.target.value);
            }}
            className="w-64"
          >
            <option value="">— selecione um RouterOS —</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.ip}</option>)}
          </Select>
          {busy && <Spinner />}
        </div>
        {err && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
      </Card>

      {!data ? (
        !busy && <EmptyState title="Selecione um device" hint="Escolha um RouterOS para rodar as checagens." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            {(["ok", "warn", "fail"] as const).map((s) => {
              const M = SEV[s];
              return (
                <Card key={s} className={cn("flex items-center gap-3 p-4", data.summary[s] > 0 && M.ring)}>
                  <M.icon className={cn("h-6 w-6", M.color)} />
                  <div>
                    <p className={cn("text-2xl font-semibold tabular-nums", M.color)}>{data.summary[s]}</p>
                    <p className="text-xs text-muted">{M.label}</p>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="space-y-2">
            {data.findings.map((f, i) => {
              const M = SEV[f.severity];
              return (
                <Card key={i} className={cn("flex items-start gap-3 p-3", M.ring)}>
                  <M.icon className={cn("mt-0.5 h-5 w-5 shrink-0", M.color)} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{f.title}</p>
                    {f.detail && <p className="text-xs text-muted">{f.detail}</p>}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
