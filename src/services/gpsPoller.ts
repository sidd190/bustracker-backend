// GPS poller — bridges the Fleettrack pull API into the live bus stream.
//
// On an interval we pull every vehicle's current state, match devices to buses
// by `gpsDeviceId`, persist the position, and emit `bus:location` to the
// school room — the exact event the student app already renders. GPS buses
// therefore need no client-side rendering changes.
//
// The poller stays dormant if Fleettrack credentials are not configured, so
// the app runs unchanged until real creds are dropped into the environment.

import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { fetchCurrentData, getFleettrackConfig, GpsState } from './fleettrack';

const prisma = new PrismaClient();

const POLL_MS = Number(process.env.FLEETTRACK_POLL_MS || 15000);
// Pilot aid: when true, parked/ignition-off buses still show on the map so you
// can verify tracking without the bus moving. Leave off in production.
const SHOW_PARKED = process.env.FLEETTRACK_SHOW_PARKED === 'true';

async function tick(io: Server) {
  const cfg = getFleettrackConfig();
  if (!cfg) return;

  let states: GpsState[];
  try {
    states = await fetchCurrentData(cfg);
  } catch (err) {
    console.error('[gps] poll failed:', (err as Error).message);
    return;
  }
  if (states.length === 0) return;

  // Index each state by every id it reports (deviceId and/or imei), plus its
  // registration number — a bus matches on its linked gpsDeviceId, or failing
  // that on number == regNo (guards against id copy-paste/leading-zero slips).
  const byDevice = new Map<string, GpsState>();
  const byRegNo = new Map<string, GpsState>();
  for (const s of states) {
    for (const id of s.ids) byDevice.set(id, s);
    if (s.regNo) byRegNo.set(s.regNo, s);
  }

  const buses = await prisma.bus.findMany({
    where: {
      OR: [
        { gpsDeviceId: { in: [...byDevice.keys()] } },
        { number: { in: [...byRegNo.keys()] } },
      ],
    },
    select: {
      id: true, name: true, number: true, schoolId: true, gpsDeviceId: true,
      driver: { select: { status: true } },
    },
  });

  for (const bus of buses) {
    const s =
      (bus.gpsDeviceId ? byDevice.get(bus.gpsDeviceId) : undefined) ??
      byRegNo.get(bus.number);
    if (!s) continue;

    // A manually-assigned driver's status governs; GPS only decides status for
    // driver-less buses. This keeps the live emit in sync with GET /buses.
    const active = s.inService || SHOW_PARKED;
    const status = bus.driver?.status ?? (active ? 'ON_DUTY' : 'OFF_DUTY');

    // Broadcast first — keep the DB out of the hot path.
    io.to(`school:${bus.schoolId}`).emit('bus:location', {
      busId: bus.id,
      name: bus.name,
      number: bus.number,
      lat: s.lat,
      lng: s.lng,
      heading: s.heading,
      speed: s.speed,
      status,
      source: 'gps',
      timestamp: s.reportedAt.getTime(),
    });

    // Persist position always; bump gpsLastSeen only while in service so the
    // GET /buses freshness gate hides buses parked at the depot.
    prisma.bus
      .update({
        where: { id: bus.id },
        data: {
          lat: s.lat,
          lng: s.lng,
          heading: s.heading,
          speed: s.speed,
          ...(active ? { gpsLastSeen: s.reportedAt } : {}),
        },
      })
      .catch(() => {});
  }
}

/** Start the recurring Fleettrack poll. No-op (with a log) when unconfigured. */
export function startGpsPoller(io: Server): void {
  if (!getFleettrackConfig()) {
    console.log('[gps] Fleettrack not configured — poller dormant (set FLEETTRACK_TOKEN/FLEETTRACK_EMAIL to enable)');
    return;
  }
  console.log(`[gps] Fleettrack poller started — every ${POLL_MS}ms`);
  // Fire once immediately, then on the interval.
  void tick(io);
  setInterval(() => void tick(io), POLL_MS);
}
