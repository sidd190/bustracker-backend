import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

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

// All buses (for driver self-assignment)
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

// Driver self-assigns to a bus
router.post('/assign', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'DRIVER') return res.status(403).json({ error: 'Forbidden' });
  const { busId, routeId } = req.body;

  const bus = await prisma.bus.findUnique({ where: { id: busId }, include: { driver: true } });
  if (!bus) return res.status(404).json({ error: 'Bus not found' });
  if (bus.driver && bus.driver.userId !== req.user!.id)
    return res.status(409).json({ error: 'Bus already assigned to another driver' });

  await prisma.driver.update({ where: { userId: req.user!.id }, data: { busId: null } });
  const driver = await prisma.driver.update({
    where: { userId: req.user!.id },
    data: { busId, routeId: routeId ?? null },
    include: { bus: true, route: true },
  });
  return res.json(driver);
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

export default router;
