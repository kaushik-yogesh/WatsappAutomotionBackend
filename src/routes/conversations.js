// routes/conversations.js
const express = require('express');
const convRouter = express.Router();
const convController = require('../controllers/conversationController');
const { protect } = require('../middleware/auth');

convRouter.use(protect);
convRouter.get('/stats', convController.getDashboardStats);
convRouter.get('/', convController.getConversations);
convRouter.get('/:id', convController.getConversation);
convRouter.patch('/:id/close', convController.closeConversation);

module.exports = convRouter;
