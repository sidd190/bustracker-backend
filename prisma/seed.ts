import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ── School ──────────────────────────────────────────────────────────────
  const school = await prisma.school.upsert({
    where: { id: 'banasthali-001' },
    update: {},
    create: { id: 'banasthali-001', name: 'Banasthali Vidyapith' },
  });

  // ── Routes ──────────────────────────────────────────────────────────────
  // Route 1: Old Market ↔ New Market (RED) — 2 buses, 7:50 AM – 7:15 PM, 15 min interval
  const marketRoute = await prisma.route.upsert({
    where: { id: 'route-market' },
    update: {},
    create: {
      id: 'route-market',
      name: 'Market Route',
      shortName: 'MKT',
      color: '#E53935',
      description: 'Old Market ↔ New Market via campus',
    },
  });

  // Route 2: Hostel ↔ Departments (YELLOW) — 3 buses, 8:30 AM – 6:30 PM
  const hostelRoute = await prisma.route.upsert({
    where: { id: 'route-hostel' },
    update: {},
    create: {
      id: 'route-hostel',
      name: 'Hostel–Department Route',
      shortName: 'HST',
      color: '#F9A825',
      description: 'Hostels ↔ Academic Departments',
    },
  });

  // Route 3: Banasthali ↔ Niwai Station (PINK) — 1 bus, 6:30 AM – 8:00 PM, 4 rounds/day
  const niwaiRoute = await prisma.route.upsert({
    where: { id: 'route-niwai' },
    update: {},
    create: {
      id: 'route-niwai',
      name: 'Niwai Station Route',
      shortName: 'NWI',
      color: '#E91E8C',
      description: 'Banasthali Campus ↔ Niwai Railway Station',
    },
  });

  // ── Schedules ────────────────────────────────────────────────────────────
  await prisma.schedule.upsert({
    where: { id: 'sched-market' },
    update: {},
    create: { id: 'sched-market', routeId: marketRoute.id, startTime: '07:50', endTime: '19:15', interval: 15 },
  });
  await prisma.schedule.upsert({
    where: { id: 'sched-hostel' },
    update: {},
    create: { id: 'sched-hostel', routeId: hostelRoute.id, startTime: '08:30', endTime: '18:30', interval: 20 },
  });
  await prisma.schedule.upsert({
    where: { id: 'sched-niwai' },
    update: {},
    create: { id: 'sched-niwai', routeId: niwaiRoute.id, startTime: '06:30', endTime: '20:00', interval: 210 },
  });

  // ── Stops — Market Route ─────────────────────────────────────────────────
  // Real Banasthali campus coordinates (approx)
  const marketStops = [
    { id: 'stop-m1', name: 'Old Market Gate', lat: 26.3942, lng: 75.8698, order: 1 },
    { id: 'stop-m2', name: 'Aarogya Mandir', lat: 26.3958, lng: 75.8712, order: 2 },
    { id: 'stop-m3', name: 'Market Saudh', lat: 26.3972, lng: 75.8720, order: 3 },
    { id: 'stop-m4', name: 'Guest House', lat: 26.3985, lng: 75.8730, order: 4 },
    { id: 'stop-m5', name: 'Shanta Vihar', lat: 26.3998, lng: 75.8718, order: 5 },
    { id: 'stop-m6', name: 'Central Library', lat: 26.4010, lng: 75.8705, order: 6 },
    { id: 'stop-m7', name: 'New Market', lat: 26.4025, lng: 75.8695, order: 7 },
  ];
  for (const s of marketStops) {
    await prisma.stop.upsert({
      where: { id: s.id },
      update: {},
      create: { ...s, routeId: marketRoute.id },
    });
  }

  // ── Stops — Hostel Route ─────────────────────────────────────────────────
  const hostelStops = [
    { id: 'stop-h1', name: 'Triveni Hostel', lat: 26.3960, lng: 75.8680, order: 1 },
    { id: 'stop-h2', name: 'Saraswati Hostel', lat: 26.3968, lng: 75.8692, order: 2 },
    { id: 'stop-h3', name: 'Laxmi Hostel', lat: 26.3975, lng: 75.8700, order: 3 },
    { id: 'stop-h4', name: 'Main Gate', lat: 26.3985, lng: 75.8712, order: 4 },
    { id: 'stop-h5', name: 'Admin Block', lat: 26.3992, lng: 75.8722, order: 5 },
    { id: 'stop-h6', name: 'Science Block', lat: 26.4000, lng: 75.8735, order: 6 },
    { id: 'stop-h7', name: 'Engineering Dept', lat: 26.4010, lng: 75.8748, order: 7 },
    { id: 'stop-h8', name: 'Management Dept', lat: 26.4018, lng: 75.8758, order: 8 },
  ];
  for (const s of hostelStops) {
    await prisma.stop.upsert({
      where: { id: s.id },
      update: {},
      create: { ...s, routeId: hostelRoute.id },
    });
  }

  // ── Stops — Niwai Route ──────────────────────────────────────────────────
  const niwaiStops = [
    { id: 'stop-n1', name: 'Banasthali Main Gate', lat: 26.3985, lng: 75.8712, order: 1 },
    { id: 'stop-n2', name: 'Banasthali Village', lat: 26.3950, lng: 75.8650, order: 2 },
    { id: 'stop-n3', name: 'Niwai Town', lat: 26.3620, lng: 75.9250, order: 3 },
    { id: 'stop-n4', name: 'Niwai Railway Station', lat: 26.3580, lng: 75.9310, order: 4 },
  ];
  for (const s of niwaiStops) {
    await prisma.stop.upsert({
      where: { id: s.id },
      update: {},
      create: { ...s, routeId: niwaiRoute.id },
    });
  }

  // ── Buses ────────────────────────────────────────────────────────────────
  const buses = [
    { id: 'bus-01', name: 'Market Bus 1', number: 'BV-01', capacity: 50 },
    { id: 'bus-02', name: 'Market Bus 2', number: 'BV-02', capacity: 50 },
    { id: 'bus-03', name: 'Hostel Bus 1', number: 'BV-03', capacity: 45 },
    { id: 'bus-04', name: 'Hostel Bus 2', number: 'BV-04', capacity: 45 },
    { id: 'bus-05', name: 'Hostel Bus 3', number: 'BV-05', capacity: 45 },
    { id: 'bus-06', name: 'Niwai Bus', number: 'BV-06', capacity: 55 },
  ];
  for (const b of buses) {
    await prisma.bus.upsert({
      where: { id: b.id },
      update: {},
      create: { ...b, schoolId: school.id },
    });
  }

  // ── Test Users ───────────────────────────────────────────────────────────
  const pw = async (p: string) => bcrypt.hash(p, 10);

  // Drivers
  const driverData = [
    { email: 'driver1@banasthali.ac.in', name: 'Ramesh Kumar', busId: 'bus-01', routeId: 'route-market' },
    { email: 'driver2@banasthali.ac.in', name: 'Suresh Singh', busId: 'bus-02', routeId: 'route-market' },
    { email: 'driver3@banasthali.ac.in', name: 'Mahesh Yadav', busId: 'bus-03', routeId: 'route-hostel' },
    { email: 'driver4@banasthali.ac.in', name: 'Dinesh Sharma', busId: 'bus-04', routeId: 'route-hostel' },
    { email: 'driver5@banasthali.ac.in', name: 'Ganesh Meena', busId: 'bus-05', routeId: 'route-hostel' },
    { email: 'driver6@banasthali.ac.in', name: 'Rajesh Gupta', busId: 'bus-06', routeId: 'route-niwai' },
  ];

  for (let i = 0; i < driverData.length; i++) {
    const d = driverData[i];
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: {},
      create: {
        name: d.name,
        email: d.email,
        password: await pw('driver123'),
        role: 'DRIVER',
        schoolId: school.id,
      },
    });
    await prisma.driver.upsert({
      where: { userId: user.id },
      update: { busId: d.busId, routeId: d.routeId },
      create: { userId: user.id, busId: d.busId, routeId: d.routeId },
    });
  }

  // Students
  for (let i = 1; i <= 3; i++) {
    await prisma.user.upsert({
      where: { email: `student${i}@banasthali.ac.in` },
      update: {},
      create: {
        name: `Student ${i}`,
        email: `student${i}@banasthali.ac.in`,
        password: await pw('student123'),
        role: 'STUDENT',
        schoolId: school.id,
      },
    });
  }

  console.log('✅ Seed complete — Banasthali Vidyapith data loaded');
}

main().catch(console.error).finally(() => prisma.$disconnect());
