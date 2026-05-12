const express = require('express');
const youtubeController = require('../controllers/youtubeController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/auth-url', youtubeController.getAuthUrl);
router.post('/callback', youtubeController.callback);
router.post('/disconnect', youtubeController.disconnect);

module.exports = router;
