// Fleettrack GPS pull-API client.
//
// Fleettrack exposes a single "current state" endpoint that returns the latest
// fix for every vehicle under an account:
//
//   GET https://app.gpstrack.in/api/get_current_data?token=<token>&email=<email>
//
// The token is constant per user. We poll this endpoint (see gpsPoller.ts),
// match each device to a Bus by deviceId, and feed positions into the same
// `bus:location` socket stream the driver app uses.

/** A single vehicle's raw payload as returned by Fleettrack. */
interface FleettrackRaw {
  latitude?: number | string;
  longitude?: number | string;
  speed?: number | string;
  date?: number | string; // epoch ms of the fix
  isoDate?: string;
  bearing?: number | string;
  ignitionStatus?: string; // "ON" | "OFF"
  vehicleStatus?: string; // "PARKED" | "RUNNING" | "MOVING" | "IDLE" | ...
  status?: string;
  regNo?: string;
  deviceId?: string;
  imei?: string;
}

/** Normalized device state we actually consume downstream. */
export interface GpsState {
  /** All identifiers this vehicle reports (deviceId and/or imei), de-duped.
   *  A bus matches if its gpsDeviceId equals any of these. */
  ids: string[];
  /** Primary id for logging — first non-empty of deviceId/imei. */
  deviceId: string;
  lat: number;
  lng: number;
  speed: number; // km/h
  heading: number; // degrees
  /** True when the vehicle is running/idling (engine on) — i.e. in service. */
  inService: boolean;
  regNo?: string;
  /** Timestamp of the GPS fix itself (not when we fetched it). */
  reportedAt: Date;
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** A parked, engine-off vehicle is not in service; everything else is. */
function deriveInService(raw: FleettrackRaw): boolean {
  const ignitionOn = String(raw.ignitionStatus ?? '').trim().toUpperCase() === 'ON';
  const vs = String(raw.vehicleStatus ?? '').trim().toUpperCase();
  return ignitionOn || vs === 'RUNNING' || vs === 'MOVING' || vs === 'IDLE';
}

/** Normalize one raw vehicle; returns null if it has no usable id or fix. */
function normalize(raw: FleettrackRaw): GpsState | null {
  const ids = [String(raw.deviceId ?? '').trim(), String(raw.imei ?? '').trim()]
    .filter((v) => v.length > 0)
    .filter((v, i, a) => a.indexOf(v) === i);
  if (ids.length === 0) return null;

  const lat = toNum(raw.latitude);
  const lng = toNum(raw.longitude);
  if (lat === 0 && lng === 0) return null; // no fix / garbage

  const reportedAt =
    raw.date != null
      ? new Date(toNum(raw.date))
      : raw.isoDate
      ? new Date(raw.isoDate)
      : new Date();

  return {
    ids,
    deviceId: ids[0],
    lat,
    lng,
    speed: toNum(raw.speed),
    heading: toNum(raw.bearing),
    inService: deriveInService(raw),
    regNo: raw.regNo ? String(raw.regNo) : undefined,
    reportedAt,
  };
}

/** The API may return a bare array, a single object, or { data: [...] }. */
function extractList(body: unknown): FleettrackRaw[] {
  if (Array.isArray(body)) return body as FleettrackRaw[];
  if (body && typeof body === 'object') {
    const data = (body as any).data;
    if (Array.isArray(data)) return data as FleettrackRaw[];
    return [body as FleettrackRaw]; // single vehicle
  }
  return [];
}

export interface FleettrackConfig {
  baseUrl: string;
  token: string;
  email: string;
}

/** Reads Fleettrack config from env, or null if not fully configured. */
export function getFleettrackConfig(): FleettrackConfig | null {
  const token = process.env.FLEETTRACK_TOKEN;
  const email = process.env.FLEETTRACK_EMAIL;
  if (!token || !email) return null;
  return {
    baseUrl: (process.env.FLEETTRACK_BASE_URL || 'https://app.gpstrack.in').replace(/\/$/, ''),
    token,
    email,
  };
}

/**
 * Fetch the current state of every vehicle under the account.
 * Throws on network/HTTP errors so the caller can log and retry next tick.
 */
export async function fetchCurrentData(
  cfg: FleettrackConfig,
  timeoutMs = 10000,
): Promise<GpsState[]> {
  const url =
    `${cfg.baseUrl}/api/get_current_data` +
    `?token=${encodeURIComponent(cfg.token)}&email=${encodeURIComponent(cfg.email)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Fleettrack HTTP ${res.status}`);
    const body = await res.json();
    return extractList(body)
      .map(normalize)
      .filter((s): s is GpsState => s !== null);
  } finally {
    clearTimeout(timer);
  }
}
