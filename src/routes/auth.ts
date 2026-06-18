import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.post('/register', async (req: Request, res: Response) => {
  const { name, email, password, role, schoolId } = req.body;
  if (!name || !email || !password || !schoolId)
    return res.status(400).json({ error: 'Missing required fields' });

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ error: 'School not found' });

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(password, 10),
        role: role === 'DRIVER' ? 'DRIVER' : 'STUDENT',
        schoolId,
      },
    });
    if (user.role === 'DRIVER') {
      await prisma.driver.create({ data: { userId: user.id } });
    }
    const token = jwt.sign(
      { id: user.id, role: user.role, schoolId: user.schoolId },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );
    return res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
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
  return res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

export default router;
