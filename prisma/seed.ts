import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const school = await prisma.school.upsert({
    where: { id: 'banasthali-001' },
    update: {},
    create: { id: 'banasthali-001', name: 'Banasthali Vidyapith' },
  });

  // ── Main Route ─────────────────────────────────────────────────────────
  const mainRoute = await prisma.route.upsert({
    where: { id: 'route-main' },
    update: {},
    create: {
      id: 'route-main',
      name: 'Main Road Route',
      shortName: 'MAIN',
      color: '#E53935',
      description: 'Main road route through campus',
    },
  });

  // ── Schedule ───────────────────────────────────────────────────────────
  await prisma.schedule.upsert({
    where: { id: 'sched-main' },
    update: {},
    create: { id: 'sched-main', routeId: mainRoute.id, startTime: '07:50', endTime: '19:15', interval: 15 },
  });

  // ── Stops — Main Route ────────────────────────────────────────────────
  const mainStops = [
    { id: 'stop-m1', name: 'Old Market Gate', lat: 26.3942, lng: 75.8698, order: 1 },
    { id: 'stop-m2', name: 'Aarogya Mandir', lat: 26.3958, lng: 75.8712, order: 2 },
    { id: 'stop-m3', name: 'Market Saudh', lat: 26.3972, lng: 75.8720, order: 3 },
    { id: 'stop-m4', name: 'Guest House', lat: 26.3985, lng: 75.8730, order: 4 },
    { id: 'stop-m5', name: 'Shanta Vihar', lat: 26.3998, lng: 75.8718, order: 5 },
    { id: 'stop-m6', name: 'Central Library', lat: 26.4010, lng: 75.8705, order: 6 },
    { id: 'stop-m7', name: 'New Market', lat: 26.4025, lng: 75.8695, order: 7 },
  ];
  for (const s of mainStops) {
    await prisma.stop.upsert({
      where: { id: s.id },
      update: {},
      create: { ...s, routeId: mainRoute.id },
    });
  }

  // ── Buses ──────────────────────────────────────────────────────────────
  const buses = [
    { id: 'bus-1401', name: 'Bus 1401', number: '1401', capacity: 50 },
    { id: 'bus-1399', name: 'Bus 1399', number: '1399', capacity: 50 },
    { id: 'bus-1400', name: 'Bus 1400', number: '1400', capacity: 50 },
    { id: 'bus-1314', name: 'Bus 1314', number: '1314', capacity: 50 },
    { id: 'bus-1317', name: 'Bus 1317', number: '1317', capacity: 50 },
  ];
  for (const b of buses) {
    await prisma.bus.upsert({
      where: { id: b.id },
      update: {},
      create: { ...b, schoolId: school.id },
    });
  }

  // ── Driver Users (common password: BVdriver2024) ──────────────────────
  const pw = async (p: string) => bcrypt.hash(p, 10);
  const driverPassword = await pw('BVdriver2024');

  for (let i = 1; i <= 5; i++) {
    const user = await prisma.user.upsert({
      where: { email: `driver${i}@banasthali.ac.in` },
      update: { password: driverPassword },
      create: {
        name: `Driver ${i}`,
        email: `driver${i}@banasthali.ac.in`,
        password: driverPassword,
        role: 'DRIVER',
        schoolId: school.id,
      },
    });
    await prisma.driver.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
  }

  // ── Test Students ─────────────────────────────────────────────────────
  const studentPw = await pw('student123');
  for (let i = 1; i <= 3; i++) {
    await prisma.user.upsert({
      where: { email: `student${i}@banasthali.ac.in` },
      update: {},
      create: {
        name: `Student ${i}`,
        email: `student${i}@banasthali.ac.in`,
        password: studentPw,
        role: 'STUDENT',
        schoolId: school.id,
      },
    });
  }

  console.log('Seed complete — Banasthali Vidyapith data loaded');
}

main().catch(console.error).finally(() => prisma.$disconnect());
