import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Server } from 'socket.io';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

export default function createBusRoutes(io: Server) {
  const router = Router();

  // All buses with assigned drivers for this school
  router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    const buses = await prisma.bus.findMany({
      where: { schoolId: req.user!.schoolId, driver: { isNot: null } },
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
    return res.json(buses);
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

  // Driver unassigns from bus (end shift)
  router.post('/unassign', authenticate, async (req: AuthRequest, res: Response) => {
    if (req.user!.role !== 'DRIVER') return res.status(403).json({ error: 'Forbidden' });
    await prisma.driver.update({
      where: { userId: req.user!.id },
      data: { busId: null, routeId: null, status: 'OFF_DUTY' },
    });
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

  // Location update via HTTP (for background tracking when socket unavailable)
  router.post('/location', authenticate, async (req: AuthRequest, res: Response) => {
    if (req.user!.role !== 'DRIVER') return res.status(403).json({ error: 'Forbidden' });
    const { busId, lat, lng, heading, speed } = req.body;

    await prisma.bus.update({
      where: { id: busId },
      data: { lat, lng, heading, speed },
    });

    const bus = await prisma.bus.findUnique({
      where: { id: busId },
      select: {
        name: true, number: true,
        driver: {
          select: {
            status: true,
            user: { select: { name: true } },
            route: { select: { id: true, name: true, shortName: true, color: true } },
          },
        },
      },
    });

    io.to(`school:${req.user!.schoolId}`).emit('bus:location', {
      busId, lat, lng, heading, speed,
      timestamp: Date.now(),
      name: bus?.name,
      number: bus?.number,
      driverName: bus?.driver?.user?.name,
      status: bus?.driver?.status,
      route: bus?.driver?.route,
    });

    return res.json({ success: true });
  });

  return router;
}
