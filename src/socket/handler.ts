import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TokenPayload { id: string; role: string; schoolId: string }

export function registerSocketHandlers(io: Server) {
  // Auth middleware
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      (socket as any).user = jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user as TokenPayload;
    socket.join(`school:${user.schoolId}`);

    // Driver sends location update
    socket.on('driver:location', async (data: {
      busId: string; lat: number; lng: number; heading?: number; speed?: number;
    }) => {
      if (user.role !== 'DRIVER') return;

      await prisma.bus.update({
        where: { id: data.busId },
        data: { lat: data.lat, lng: data.lng, heading: data.heading, speed: data.speed },
      });

      const bus = await prisma.bus.findUnique({
        where: { id: data.busId },
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

      io.to(`school:${user.schoolId}`).emit('bus:location', {
        busId: data.busId,
        lat: data.lat,
        lng: data.lng,
        heading: data.heading,
        speed: data.speed,
        timestamp: Date.now(),
        name: bus?.name,
        number: bus?.number,
        driverName: bus?.driver?.user?.name,
        status: bus?.driver?.status,
        route: bus?.driver?.route,
      });
    });

    // Driver updates status
    socket.on('driver:status', async (data: { status: string }) => {
      if (user.role !== 'DRIVER') return;

      const driver = await prisma.driver.update({
        where: { userId: user.id },
        data: { status: data.status as any },
        include: {
          bus: true,
          user: { select: { name: true } },
          route: { select: { id: true, name: true, shortName: true, color: true } },
        },
      });

      if (driver.busId) {
        io.to(`school:${user.schoolId}`).emit('bus:status', {
          busId: driver.busId,
          status: data.status,
          driverName: driver.user.name,
          busName: driver.bus?.name,
          route: driver.route,
        });
      }
    });

    socket.on('disconnect', () => {});
  });
}
