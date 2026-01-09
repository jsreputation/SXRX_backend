// backend/src/routes/tebraQuestionnaire.js
const express = require('express');
const router = express.Router();

const controller = require('../controllers/tebraQuestionnaireController');
const { auth } = require('../middleware/shopifyTokenAuth');
const { createRateLimiter } = require('../middleware/rateLimit');

// Apply rate limiting to questionnaire submissions (5 per minute per IP/user)
const submitLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

// Get questionnaire submissions for a patient
router.get('/list', auth, controller.list);

// Protect questionnaire submission: only signed-in users may submit
router.post('/submit', auth, submitLimiter, express.json({ limit: '2mb' }), controller.submit);

module.exports = router;
