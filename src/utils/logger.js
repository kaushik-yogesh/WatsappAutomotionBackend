const winston = require('winston');
const path = require('path');

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'white' };
winston.addColors(colors);

// Custom format to mask sensitive data like access_token, api_key, etc.
const maskSensitive = winston.format((info) => {
  const sensitiveKeys = ['access_token', 'accessToken', 'api_key', 'apiKey', 'api_secret', 'apiSecret', 'secret', 'password', 'token', 'botToken'];
  
  const mask = (obj) => {
    for (let key in obj) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        obj[key] = '***REDACTED***';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        mask(obj[key]);
      }
    }
  };

  // Clone to avoid mutating the original object if it's reused
  if (typeof info.message === 'string') {
    sensitiveKeys.forEach(key => {
      const regex = new RegExp(`(${key}=|"${key}":\\s*")[^"&\\s]+`, 'gi');
      info.message = info.message.replace(regex, `$1***REDACTED***`);
    });
  }
  
  if (info.metadata) mask(info.metadata);
  
  return info;
});

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  maskSensitive(),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  winston.format.printf((info) => {
    const meta = Object.keys(info.metadata).length ? `\n${JSON.stringify(info.metadata, null, 2)}` : '';
    return `${info.timestamp} ${info.level}: ${info.message}${meta}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  maskSensitive(),
  winston.format.json()
);

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    )
  }),
  new winston.transports.File({ 
    filename: path.join('logs', 'error.log'), 
    level: 'error',
    format: fileFormat
  }),
  new winston.transports.File({ 
    filename: path.join('logs', 'publish.log'),
    format: fileFormat
  }),
];

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  levels,
  transports,
});

module.exports = logger;
