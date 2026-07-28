export type DeviceType = "routeros" | "huawei" | "cisco";
export type CredentialKind = "ssh" | "telnet" | "snmp" | "api" | "tl1";

export interface AppUser {
  id: number;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  document?: string | null;
  photo?: string | null;
  is_admin: boolean;
  is_active?: boolean;
  role?: string;
  org_id?: number | null;
  usergroup_id?: number | null;
}

export interface UserGroup {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface Plan {
  id: number;
  name: string;
  max_devices: number;
  max_users: number;
}
// === Planos (autosserviço do admin da ORG — /plans) ===
export interface PlanOption {
  id: number;
  name: string;
  max_devices: number;
  max_users: number;
}
export type PlanStatus = "none" | "active" | "canceled" | "expired";
export interface CurrentPlan {
  has_org: boolean;
  plan_id: number | null;
  plan_name: string | null;
  max_devices: number;
  max_users: number;
  device_limit_override: boolean;
  usage: { devices: number; users: number };
  status: PlanStatus;
  expires_at: string | null;
  canceled: boolean;
  expired: boolean;
  trial_available: boolean;
}

/** Notificação da central do usuário (/notifications). */
export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  created_at: string | null;
  read: boolean;
  read_at: string | null;
}

/** Resumo da própria empresa (Danger Zone em Settings — admin da empresa). */
export interface OrgSummary {
  id: number;
  name: string;
  plan_name: string | null;
  plan_status: PlanStatus;
  plan_expires_at: string | null;
  plan_canceled: boolean;
  counts: { devices: number; sites: number; users: number; credentials: number; backups: number };
}

export interface OrgMeta {
  id: number;
  name: string;
  plan_id: number | null;
  plan: string | null;
  device_limit: number | null;
  user_limit: number;
  devices: number;
  users: number;
  active_users: number;
  plan_expires_at: string | null;
  plan_canceled: boolean;
  plan_status: PlanStatus;
  admin_username: string | null;
  admin_email: string | null;
}

export interface GlobalSmtp {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  from_addr: string;
  use_tls: boolean;
  password_set: boolean;
}

export interface CopilotConversation {
  id: number;
  title: string;
  mode: "chat" | "manual" | "auto";
  device_ids: number[];
  tokens_total: number;
  tokens_context: number;
  created_at: string;
  updated_at: string;
}
export interface CopilotMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning: string | null;
  tool_calls: string[];
  name: string | null;
  created_at: string;
}
export interface CopilotAction {
  id: number;
  device_id: number | null;
  command: string;
  rationale: string;
  classification: "read" | "write";
  high_risk: boolean;
  status: "pending" | "executed" | "failed" | "rejected";
  output: string;
  created_at: string;
}
export interface CopilotDetail {
  conversation: CopilotConversation;
  messages: CopilotMessage[];
  actions: CopilotAction[];
}
export interface CopilotTool {
  id: number;
  kind: "mcp" | "openapi" | "skill";
  name: string;
  enabled: boolean;
  url: string;
  spec_url: string;
  base_url: string;
  auth_header: string;
  auth_set: boolean;
  content_len: number;
}

export interface Integrations {
  ftp: { enabled: boolean; host: string; port: number; username: string; path: string; use_tls: boolean; password_set: boolean };
}

export interface GlobalS3 {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  access_key: string;
  prefix: string;
  use_ssl: boolean;
  secret_key_set: boolean;
}

export interface GlobalLlm {
  enabled: boolean;
  base_url: string;
  model: string;
  api_key_set: boolean;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string;
  enabled: boolean;
  has_secret: boolean;
}

export interface ApiKeyMeta {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}
export interface ApiKeyCreated extends ApiKeyMeta {
  token: string;
}

export interface BackupMeta {
  id: number;
  device_id: number;
  device_name: string;
  created_at: string;
  size: number;
}
export interface BackupFull {
  id: number;
  device_id: number;
  created_at: string;
  size: number;
  content: string;
}

export interface Credential {
  id: number;
  name: string;
  kind: CredentialKind;
  username: string;
  secret: string;
  snmp_version: string | null;
}

export interface Group {
  id: number;
  name: string;
  location: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  default_ssh_credential_id: number | null;
  default_snmp_credential_id: number | null;
}

export interface Rack {
  id: number;
  site_id: number;
  name: string;
  description: string;
}
export interface RackLink {
  id: number;
  rack_a_id: number;
  rack_b_id: number;
  iface_a: string;
  iface_b: string;
}

export interface Controller {
  id: number;
  name: string;
  kind: string;
  host: string;
  port: number;
  credential_id: number | null;
}

export interface Device {
  id: number;
  org_id: number | null;
  name: string;
  ip: string;
  device_type: DeviceType;
  group_id: number | null;
  rack_id: number | null;
  ssh_enabled: boolean;
  telnet_enabled: boolean;
  snmp_enabled: boolean;
  api_enabled: boolean;
  notes: string;
  latitude: number | null;
  longitude: number | null;
}

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  target_kind: string;
  target_id: number;
  protocol: string;
  command: string;
  classification: "read" | "write";
  ok: boolean;
  error: string | null;
  duration_ms: number;
  output_summary: string;
}

export interface Template {
  id: number;
  name: string;
  description: string;
  category: string;
  type: string; // commands | script
  body: string;
  enabled: boolean;
}

export interface CatalogOp {
  key: string;
  label: string;
  protocol: string;
  walk: boolean;
}

export interface SnmpRecord {
  oid: string;
  type: string;
  value: string;
}

// === Fiberhome/UNM2000 (TL1 ao vivo) ===
// Registros TL1 são dicionários dinâmicos (colunas variam por comando).
export type Tl1Record = Record<string, string>;
export type Tl1Data = Tl1Record[] | { error: string; raw?: string[] };

export interface OltsResp { ok: boolean; controller: string; olts: Tl1Data }
export interface PonsResp { ok: boolean; controller: string; olt: string; ponid: string | null; pons: Tl1Data }
export interface OnusResp { ok: boolean; controller: string; olt: string; ponid: string | null; onus: Tl1Data }
export interface UnregResp { ok: boolean; controller: string; olt: string; unregistered: Tl1Data }

export interface LocateOnu {
  query: Tl1Data;
  state: Tl1Data;
  optical: Tl1Data;
  info: Tl1Data;
  lan_port: Tl1Data;
  config: Tl1Data;
  macaddress: Tl1Data;
  lan_info: Tl1Data;
}
export interface LocateResp { ok: boolean; controller: string; olt: string; onuid: string; onu: LocateOnu | { error: string } }

// Alarmes retornam linhas brutas do TL1 (QUERY-ALARM não é tabular).
export interface AlarmsResp { ok: boolean; controller: string; olt: string; alarms: string[] }

// === MikroTik (RouterOS) — leitura ao vivo via SSH ===
export type RosRecord = Record<string, string>;

// Snapshot do poller (status + métricas), lido sem conectar ao device.
export interface DeviceStatusInfo {
  device_id: number;
  status: "online" | "not_accessible" | "offline" | "disabled" | "unknown";
  cpu_load: string | null;
  ram_used_pct: number | null;
  temperature: string | null;
  uptime: string | null;
  version: string | null;
  board: string | null;
  current_firmware: string | null;
  upgrade_firmware: string | null;
  error: string | null;
  checked_at: string | null;
}

export interface RosSystem {
  cpu_load: string | null;
  ram_used_pct: number | null;
  free_memory: number | null;
  total_memory: number | null;
  temperature: string | null;
  uptime: string | null;
  version: string | null;
  board: string | null;
  board_name: string | null;
  architecture: string | null;
  serial: string | null;
  current_firmware: string | null;
  upgrade_firmware: string | null;
}
export interface DeviceSample {
  ts: string;
  cpu_load: number | null;
  ram_used_pct: number | null;
  temperature: number | null;
}

export interface SystemResp { ok: boolean; device: string; summary: RosSystem; raw: RosRecord }
export interface OverviewResp {
  ok: boolean;
  device: string;
  summary: RosSystem;
  interfaces: RosRecord[];
  services: RosRecord[];
  raw: RosRecord;
}
export interface InterfacesResp { ok: boolean; device: string; interfaces: RosRecord[] }
export interface NetInfoResp { ok: boolean; device: string; interfaces: RosRecord[]; wan: string[] }
export interface FirewallResp { ok: boolean; device: string; rules: RosRecord[] }
export interface DhcpServersResp { ok: boolean; device: string; servers: RosRecord[] }
export interface DhcpLeasesResp { ok: boolean; device: string; leases: RosRecord[] }
export interface RoutesResp { ok: boolean; device: string; routes: RosRecord[] }
export interface ServicesResp { ok: boolean; device: string; services: RosRecord[] }
export interface TrafficResp { ok: boolean; iface: string; rx_bps: number; tx_bps: number }
export interface NeighborsResp { ok: boolean; device: string; neighbors: RosRecord[] }
export interface LogsResp { ok: boolean; device: string; logs: RosRecord[] }
export interface SecurityFinding { severity: "ok" | "warn" | "fail"; title: string; detail: string }
export interface SecurityResp {
  ok: boolean;
  device: string;
  findings: SecurityFinding[];
  summary: { ok: number; warn: number; fail: number };
}

// === Observabilidade (aba /logs, só Admin Master) — espelha app/schemas/observability.py ===
export interface ObsEvent {
  id: string | null;
  ts: string | null;
  level: string;
  logger: string | null;
  service: string;
  message: string;
  /** Código de causa provável; traduzido em ops:observability.friendly.<code>. */
  friendly: string;
  request_id: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  user: string | null;
  org_id: number | null;
  duration_ms: number | null;
  error_type: string | null;
  has_stack: boolean;
}
/** Stack trace só existe no detalhe — a listagem nunca o traz. */
export interface ObsEventDetail extends ObsEvent { stack: string | null; user_id: number | null }
export interface ObsEventPage { items: ObsEvent[]; total: number; scanned: number; truncated: boolean }
export interface ObsErrorGroup {
  fingerprint: string;
  count: number;
  level: string;
  service: string;
  message: string;
  friendly: string;
  last_ts: string | null;
  last_id: string | null;
}
export interface ObsSummary {
  hours: number | null;
  total: number;
  critical: number;
  warnings: number;
  by_level: Record<string, number>;
  by_service: Record<string, number>;
  top_errors: ObsErrorGroup[];
  last_event_ts: string | null;
  available: boolean;
}
