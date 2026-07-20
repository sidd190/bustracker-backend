import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import authRoutes from './routes/auth';
import busRoutes from './routes/bus';
import feedbackRoutes from './routes/feedback';
import { registerSocketHandlers } from './socket/handler';

dotenv.config();

const app = express();
const server = http.createServer(app);

export const io = new Server(server, {
  cors: { origin: '*' },
  // Tune for 1000 concurrent connections
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/buses', busRoutes);
app.use('/api/feedback', feedbackRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

registerSocketHandlers(io);

const PORT = process.env.PORT || 3001;
server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚌 BusTracker backend running on http://0.0.0.0:${PORT}`);
});
