// backend/src/routes/telemed.js
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/shopifyTokenAuth');
const telemedController = require('../controllers/telemedController');

router.post('/appointments', auth, telemedController.bookAppointment);

module.exports = router;
