// routes/conversations.js
const express = require('express');
const convRouter = express.Router();
const convController = require('../controllers/conversationController');
const { protect } = require('../middleware/auth');

convRouter.use(protect);
convRouter.get('/stats', convController.getDashboardStats);
convRouter.get('/leads', convController.getLeadsDashboard);   // ← Lead Intelligence
convRouter.get('/', convController.getConversations);
convRouter.get('/:id', convController.getConversation);
convRouter.post('/:id/reply', convController.replyToConversation);
convRouter.patch('/:id/close', convController.closeConversation);

module.exports = convRouter;

