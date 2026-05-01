require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const hpp = require('hpp');

const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const AppError = require('./utils/AppError');

// Routes
const authRoutes = require('./routes/auth');
const whatsappRoutes = require('./routes/whatsapp');
const agentRoutes = require('./routes/agents');
const conversationRoutes = require('./routes/conversations');
const billingRoutes = require('./routes/billing');
const telegramRoutes = require('./routes/telegramRoutes');
const telegramWebhookRoutes = require('./routes/telegramWebhookRoutes');
const instagramRoutes = require('./routes/instagramRoutes');
const instagramWebhookRoutes = require('./routes/instagramWebhookRoutes');
const socialHubRoutes = require('./routes/socialHub');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const { checkMaintenance } = require('./middleware/maintenance');
const { healthMonitor } = require('./middleware/healthMonitor');

const app = express();

// ─── Connect DB ───────────────────────────────────────────
connectDB();
app.set('trust proxy', 1);
// ─── Security Middleware ──────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'https://automation.poojatrendhub.com'
    ];
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.some(ao => ao && ao.startsWith(origin)) || 
                      origin.endsWith('.vercel.app');

    if (isAllowed) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting - global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { status: 'error', message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { status: 'error', message: 'Too many auth attempts. Please try after 15 minutes.' },
});

 
app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

const fileUpload = require('express-fileupload');

// ... existing code ...

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// File upload middleware
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
}));

// Data sanitization
app.use(mongoSanitize()); // NoSQL injection
app.use(hpp()); // HTTP Parameter Pollution

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── Health Check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────
app.use(healthMonitor);
app.use(checkMaintenance);
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/telegram/webhook', telegramWebhookRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/instagram/webhook', instagramWebhookRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/social-hub', socialHubRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// ─── 404 Handler ─────────────────────────────────────────
app.all('*', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404));
});

// ─── Global Error Handler ─────────────────────────────────
app.use(errorHandler);

const { initSocket } = require('./utils/socket');

// ─── Start Server ─────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Initialize Socket.io
initSocket(server);

// Graceful shutdown
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION:', err.message);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => logger.info('Process terminated.'));
});

module.exports = app;
