import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

export default function createBusRoutes(io: Server) {
  const router = Router();

  // Buses visible to students: those with an assigned driver, OR those tracked
  // by a GPS device that has reported in-service recently. Each bus carries a
  // computed `status` — the driver's manual status wins; otherwise a live GPS
  // bus is ON_DUTY (the freshness gate already excludes parked/stale ones).
  router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    const staleMs = Number(process.env.FLEETTRACK_STALE_MS || 90000);
    const freshSince = new Date(Date.now() - staleMs);

    const buses = await prisma.bus.findMany({
      where: {
        schoolId: req.user!.schoolId,
        OR: [
          { driver: { isNot: null } },
          { gpsDeviceId: { not: null }, gpsLastSeen: { gt: freshSince } },
        ],
      },
      include: {
        driver: {
          select: {
            id: true, status: true, userId: true,
            user: { select: { id: true, name: true } },
            route: { select: { id: true, name: true, shortName: true, color: true } },
          },
        },
      },
    });

    const withStatus = buses.map((bus) => ({
      ...bus,
      // Driver status wins; otherwise the GPS-derived status (On Route / On
      // Break) persisted by the poller, reflecting the device's real state.
      status: bus.driver?.status ?? bus.gpsStatus ?? 'ON_DUTY',
    }));
    return res.json(withStatus);
  });

  // All buses (for driver bus picker)
  router.get('/all', authenticate, async (req: AuthRequest, res: Response) => {
    const buses = await prisma.bus.findMany({
      where: { schoolId: req.user!.schoolId },
      include: {
        driver: { select: { userId: true, user: { select: { name: true } } } },
      },
    });
    return res.json(buses);
  });

  // Routes with stops and schedules
  router.get('/routes', authenticate, async (req: AuthRequest, res: Response) => {
    const routes = await prisma.route.findMany({
      include: {
        stops: { orderBy: { order: 'asc' } },
        schedules: true,
      },
    });
    return res.json(routes);
  });

  // Driver self-assigns to a bus (last-claim-wins)
  router.post('/assign', authenticate, async (req: AuthRequest, res: Response) => {
    if (req.user!.role !== 'DRIVER') return res.status(403).json({ error: 'Forbidden' });
    const { busId, routeId } = req.body;

    const bus = await prisma.bus.findUnique({ where: { id: busId } });
    if (!bus) return res.status(404).json({ error: 'Bus not found' });

    // Unassign whoever currently has this bus
    await prisma.driver.updateMany({
      where: { busId },
      data: { busId: null, routeId: null, status: 'OFF_DUTY' },
    });

    // Unassign this driver from any current bus
    await prisma.driver.update({
      where: { userId: req.user!.id },
      data: { busId: null },
    });

    const driver = await prisma.driver.update({
      where: { userId: req.user!.id },
      data: { busId, routeId: routeId ?? null },
      include: { bus: true, route: true },
    });
    return res.json(driver);
  });

  // Driver unassigns from bus (end shift). Releases the bus AND wipes its last
  // position so no ghost location lingers for the next driver / student map.
  router.post('/unassign', authenticate, async (req: AuthRequest, res: Response) => {
    if (req.user!.role !== 'DRIVER') return res.status(403).json({ error: 'Forbidden' });

    const driver = await prisma.driver.findUnique({
      where: { userId: req.user!.id },
      select: { busId: true },
    });

    await prisma.driver.update({
      where: { userId: req.user!.id },
      data: { busId: null, routeId: null, status: 'OFF_DUTY' },
    });

    if (driver?.busId) {
      await prisma.bus.update({
        where: { id: driver.busId },
        data: { lat: null, lng: null, speed: null, heading: null },
      });
    }

    return res.json({ success: true });
  });

  // Driver updates status
  router.patch('/driver/status', authenticate, async (req: AuthRequest, res: Response) => {
    if (req.user!.role !== 'DRIVER') return res.status(403).json({ error: 'Forbidden' });
    const { status } = req.body;
    const driver = await prisma.driver.update({
      where: { userId: req.user!.id },
      data: { status },
    });
    return res.json(driver);
  });

  // Location update via HTTP (background tracking fallback when socket unavailable)
  router.post('/location', authenticate, async (req: AuthRequest, res: Response) => {
    if (req.user!.role !== 'DRIVER') return res.status(403).json({ error: 'Forbidden' });
    const { busId, lat, lng, heading, speed } = req.body;

    const driver = await prisma.driver.findUnique({
      where: { userId: req.user!.id },
      select: { busId: true },
    });
    if (!driver || driver.busId !== busId) {
      return res.status(403).json({ error: 'NOT_ASSIGNED' });
    }

    // Broadcast immediately — no DB round-trip in the hot path
    io.to(`school:${req.user!.schoolId}`).emit('bus:location', {
      busId, lat, lng, heading, speed,
      timestamp: Date.now(),
    });

    // Persist asynchronously
    prisma.bus.update({
      where: { id: busId },
      data: { lat, lng, heading, speed },
    }).catch(() => {});

    return res.json({ success: true });
  });

  // Admin cleanup — delete extra buses, unassign all drivers
  router.post('/admin/cleanup', async (req: any, res: Response) => {
    const { secret } = req.body;
    if (secret !== process.env.JWT_SECRET) return res.status(403).json({ error: 'Forbidden' });

    await prisma.driver.updateMany({
      data: { busId: null, routeId: null, status: 'OFF_DUTY' },
    });

    const KEEP_NUMBERS = ['1401', '1399', '1400', '1314', '1317'];
    const keepBuses = await prisma.bus.findMany({
      where: { number: { in: KEEP_NUMBERS } },
      select: { id: true },
    });
    const keepIds = keepBuses.map((b: any) => b.id);

    const deleted = await prisma.bus.deleteMany({
      where: { id: { notIn: keepIds } },
    });

    const drivers = await prisma.driver.findMany({
      select: { id: true, userId: true },
    });
    for (let i = 0; i < drivers.length; i++) {
      await prisma.user.update({
        where: { id: drivers[i].userId },
        data: { name: `Driver ${i + 1}` },
      });
    }

    if (req.body.newPin) {
      const hash = await bcrypt.hash(req.body.newPin, 10);
      await prisma.user.updateMany({
        where: { role: 'DRIVER' },
        data: { password: hash },
      });
    }

    res.json({ driversReset: true, busesDeleted: deleted.count, busesKept: keepIds.length, driversRenamed: drivers.length, pinChanged: !!req.body.newPin });
  });

  return router;
}
