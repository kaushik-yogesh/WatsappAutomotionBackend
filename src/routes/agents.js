// routes/agents.js
const express = require('express');
const agentRouter = express.Router();
const agentController = require('../controllers/agentController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

agentRouter.use(protect);
agentRouter.get('/models', agentController.getAvailableModels);
agentRouter.route('/')
  .get(agentController.getAgents)
  .post(validate(schemas.createAgent), agentController.createAgent);
agentRouter.route('/:id')
  .get(agentController.getAgent)
  .patch(agentController.updateAgent)
  .delete(agentController.deleteAgent);
agentRouter.post('/:id/toggle', agentController.toggleAgent);
agentRouter.post('/:id/test', agentController.testAgent);

module.exports = agentRouter;
