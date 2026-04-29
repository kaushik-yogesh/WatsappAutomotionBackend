const SystemSetting = require('../models/SystemSetting');
const AppError = require('../utils/AppError');

/**
 * Middleware to check if system is in maintenance mode
 */
const checkMaintenance = async (req, res, next) => {
  try {
    // Skip maintenance check for admin routes or if the user is an admin
    if (req.originalUrl.startsWith('/api/admin') || (req.user && req.user.role === 'admin')) {
      return next();
    }

    const maintenanceSetting = await SystemSetting.findOne({ key: 'maintenance_mode' });
    
    if (maintenanceSetting && maintenanceSetting.value === true) {
      return next(new AppError('System is under maintenance. Please try again later.', 503));
    }

    next();
  } catch (err) {
    // If DB check fails, default to allowing traffic but log the error
    console.error('Maintenance check error:', err);
    next();
  }
};

module.exports = { checkMaintenance };
