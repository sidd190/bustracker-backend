import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { message } = req.body;
  if (!message || !message.trim())
    return res.status(400).json({ error: 'Feedback message is required' });

  const feedback = await prisma.feedback.create({
    data: {
      message: message.trim(),
      userId: req.user!.id,
    },
  });
  return res.json(feedback);
});

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const feedbacks = await prisma.feedback.findMany({
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true, email: true } } },
  });
  return res.json(feedbacks);
});

export default router;
