// Hand-written response shapes that mirror what `/v1/*` actually returns.
// Kept loose on purpose — we only name fields we read; everything else passes
// through verbatim so a backend schema addition does not break the MCP.

export interface AccountResponse {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  balance?: string | number;
  tier?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export interface RegionResponse {
  slug: string;
  name: string;
  [k: string]: unknown;
}

export interface OsTemplateResponse {
  id: string;
  family: string;
  label: string;
  icon?: string;
  color?: string;
}

export interface ProductResponse {
  id: string;
  name?: string;
  vcpu?: number;
  ramGb?: number;
  diskGb?: number;
  bandwidthGb?: number;
  pricePerMonth?: string | number;
  [k: string]: unknown;
}

export interface ServerSummary {
  id: string;
  label?: string;
  status?: string;
  os?: string;
  region?: string;
  ipAddress?: string | null;
  additionalIps?: Array<{ ip: string; gateway?: string; netmask?: string; cidr?: string }>;
  [k: string]: unknown;
}

export interface ServerDetail extends ServerSummary {
  networking?: {
    primaryIp: string | null;
    gateway: string | null;
    additionalIps: Array<{ ip: string; gateway?: string; netmask?: string; cidr?: string; region?: string }>;
  };
  specs?: {
    vcpu?: number;
    ramMb?: number;
    ramGb?: number | null;
    diskGb?: number;
    bandwidthGb?: number;
    os?: string;
    region?: string;
  };
}

export interface CredentialsResponse {
  username?: string;
  password?: string;
  ip?: string;
  port?: number;
  [k: string]: unknown;
}

export interface SsoResponse {
  url: string;
  expiresIn: number;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber?: string;
  total?: string | number;
  status?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export interface WalletResponse {
  address: string;
  chain: string;
  balance?: string | number;
  isActive?: boolean;
  [k: string]: unknown;
}

export interface WebhookSummary {
  id: string;
  url: string;
  events?: string[];
  [k: string]: unknown;
}

export interface ResellerTier {
  name: string;
  min30dGmv: number;
  discountPct: number;
}

export interface ResellerStateResponse {
  enabled: boolean;
  enabledAt?: string | null;
  balance: number;
  minBalance: number;
  eligible: boolean;
  discountPct: number;
  discountOverride?: number | null;
  tierName: string | null;
  gmv30d: number;
  nextTier: {
    name: string;
    gmvRequired: number;
    gmvRemaining: number;
    discountPct: number;
  } | null;
  tiers: ResellerTier[];
  [k: string]: unknown;
}
