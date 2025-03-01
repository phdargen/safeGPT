import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeAgent } from './services/agent';
import { setupWebSocket } from './websocket';
import { apiRouter } from './routes';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 10000,
  upgradeTimeout: 30000,
  transports: ["websocket", "polling"]
});

app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:3000'],
  methods: ['GET', 'POST']
}));
app.use(express.json());

// API routes
app.use('/api', apiRouter);

// WebSocket setup
setupWebSocket(io);

// Log socket server events
io.engine.on("connection_error", (err) => {
  console.log("Connection error:", err);
});

io.engine.on("headers", (headers, req) => {
  console.log("Handshake initiated");
});

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, async () => {
  try {
    console.log(`Server running on port ${PORT}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}); 