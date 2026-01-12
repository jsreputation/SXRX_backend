// backend/src/routes/tebraAppointmentReason.js
const express = require('express');
const router = express.Router();
const tebraAppointmentReasonController = require('../controllers/tebraAppointmentReasonController');
const { auth } = require('../middleware/shopifyTokenAuth');

// Get appointment reasons
router.post('/get', auth, tebraAppointmentReasonController.getAppointmentReasons);

module.exports = router;
