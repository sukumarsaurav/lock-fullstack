import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import * as mqtt from 'mqtt';
import config from './config/app';
import db from './config/db';
import { errorHandler, notFound } from './middleware/error';
import { handleFavicon } from './middleware/favicon';

// Import routes
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import lockerRoutes from './routes/lockerRoutes';

// Initialize express app
const app = express();
const server = http.createServer(app);

// Set up Socket.IO for real-time communication
const io = new SocketServer(server, {
  cors: {
    origin: config.app.corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Set up MQTT client for IoT communication
const mqttClient = mqtt.connect(config.mqtt.brokerUrl, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  clientId: config.mqtt.clientId
});

// Middleware
app.use(handleFavicon);
app.use(helmet());
app.use(cors({
  origin: config.app.corsOrigins,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/lockers', lockerRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use(notFound);

// Error handler - Use express error handler signature
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  errorHandler(err, req, res, next);
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Join a room for user-specific updates
  socket.on('join_user', (userId) => {
    socket.join(`user:${userId}`);
    console.log(`Socket ${socket.id} joined room for user ${userId}`);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// MQTT connection handler
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  
  // Subscribe to locker status topics
  mqttClient.subscribe('lockers/+/status', (err) => {
    if (!err) {
      console.log('Subscribed to locker status topics');
    }
  });
});

// MQTT message handler
mqttClient.on('message', (topic, message) => {
  console.log(`Received message from ${topic}: ${message.toString()}`);
  
  // Extract locker ID from topic
  const lockerId = topic.split('/')[1];
  
  // Forward to Socket.IO clients
  io.emit(`locker:${lockerId}`, {
    time: new Date().toISOString(),
    topic,
    message: message.toString()
  });
});

// Initialize database and start server
const PORT = config.app.port;

const startServer = async () => {
  try {
    // Test database connection
    const isConnected = await db.testConnection();
    
    if (!isConnected) {
      console.error('Database connection failed. Exiting...');
      process.exit(1);
    }
    
    // Initialize database if in development mode
    if (config.app.env === 'development') {
      await db.initDatabase();
    }
    
    // Start the server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT} in ${config.app.env} mode`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    console.log('HTTP server closed');
    
    mqttClient.end(true, () => {
      console.log('MQTT client disconnected');
      process.exit(0);
    });
  });
}); 