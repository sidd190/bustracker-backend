import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.post('/register', async (req: Request, res: Response) => {
  const { name, email, password, schoolId } = req.body;
  if (!name || !email || !password || !schoolId)
    return res.status(400).json({ error: 'Missing required fields' });

  if (!email.toLowerCase().endsWith('@banasthali.in'))
    return res.status(400).json({ error: 'Only Banasthali student emails (@banasthali.in) are allowed' });

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ error: 'School not found' });

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(password, 10),
        role: 'STUDENT',
        schoolId,
      },
    });
    const token = jwt.sign(
      { id: user.id, role: user.role, schoolId: user.schoolId },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Email already registered' });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    process.env.JWT_SECRET!,
    { expiresIn: '30d' }
  );
  return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// Legacy shared-password login (kept for backward compat)
router.post('/driver-login', async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const drivers = await prisma.user.findMany({
    where: { role: 'DRIVER' },
    include: { driver: true },
  });

  if (drivers.length === 0)
    return res.status(404).json({ error: 'No driver accounts configured' });

  let matched = false;
  for (const d of drivers) {
    if (await bcrypt.compare(password, d.password)) { matched = true; break; }
  }
  if (!matched) return res.status(401).json({ error: 'Invalid password' });

  const available = drivers.find(d => !d.driver?.busId) ?? drivers[0];

  const token = jwt.sign(
    { id: available.id, role: 'DRIVER', schoolId: available.schoolId },
    process.env.JWT_SECRET!,
    { expiresIn: '12h' }
  );
  return res.json({ token, user: { id: available.id, name: available.name, role: 'DRIVER' } });
});

// New: claim a bus with PIN — combines login + assign in one step
router.post('/claim-bus', async (req: Request, res: Response) => {
  const { busNumber, pin } = req.body;
  if (!busNumber || !pin)
    return res.status(400).json({ error: 'Bus number and PIN required' });

  const bus = await prisma.bus.findFirst({ where: { number: busNumber } });
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const driverUsers = await prisma.user.findMany({
    where: { role: 'DRIVER', schoolId: bus.schoolId },
    include: { driver: true },
  });
  if (!driverUsers.length)
    return res.status(404).json({ error: 'No driver accounts configured' });

  let pinValid = false;
  for (const d of driverUsers) {
    if (await bcrypt.compare(pin, d.password)) { pinValid = true; break; }
  }
  if (!pinValid) return res.status(401).json({ error: 'Invalid PIN' });

  // Last-claim-wins: unassign whoever currently has this bus
  const previousHolders = await prisma.driver.findMany({
    where: { busId: bus.id },
    select: { id: true },
  });
  const previousIds = previousHolders.map(d => d.id);

  await prisma.driver.updateMany({
    where: { busId: bus.id },
    data: { busId: null, routeId: null, status: 'OFF_DUTY' },
  });

  // Pick a different driver account so the old JWT becomes invalid
  let freshDrivers = await prisma.driver.findMany({
    where: { user: { schoolId: bus.schoolId }, busId: null, id: { notIn: previousIds } },
    include: { user: true },
  });
  if (!freshDrivers.length) {
    freshDrivers = await prisma.driver.findMany({
      where: { user: { schoolId: bus.schoolId }, busId: null },
      include: { user: true },
    });
  }
  const driverRecord = freshDrivers[0];
  if (!driverRecord)
    return res.status(500).json({ error: 'No available driver slots' });

  const route = await prisma.route.findFirst();
  await prisma.driver.update({
    where: { id: driverRecord.id },
    data: { busId: bus.id, routeId: route?.id ?? null },
  });

  const token = jwt.sign(
    { id: driverRecord.userId, role: 'DRIVER', schoolId: bus.schoolId },
    process.env.JWT_SECRET!,
    { expiresIn: '12h' }
  );

  return res.json({
    token,
    user: { id: driverRecord.userId, name: driverRecord.user.name, role: 'DRIVER' },
    bus: { id: bus.id, name: bus.name, number: bus.number },
  });
});

export default router;
