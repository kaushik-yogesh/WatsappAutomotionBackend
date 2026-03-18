// routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

router.post('/register', validate(schemas.register), authController.register);
router.post('/login', validate(schemas.login), authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/forgot-password', validate(schemas.forgotPassword), authController.forgotPassword);
router.patch('/reset-password/:token', validate(schemas.resetPassword), authController.resetPassword);

router.use(protect);
router.get('/me', authController.getMe);
router.patch('/update-profile', authController.updateProfile);
router.patch('/change-password', authController.changePassword);

module.exports = router;
