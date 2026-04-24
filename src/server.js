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

const app = express();

// ─── Connect DB ───────────────────────────────────────────
connectDB();
app.set('trust proxy', 1);
// ─── Security Middleware ──────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://automation.poojatrendhub.com'
  ],
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

// Body parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

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
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/telegram/webhook', telegramWebhookRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/instagram/webhook', instagramWebhookRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/billing', billingRoutes);

// ─── 404 Handler ─────────────────────────────────────────
app.all('*', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404));
});

// ─── Global Error Handler ─────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

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
