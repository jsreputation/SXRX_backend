// backend/src/routes/newPatientForm.js
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/shopifyTokenAuth');
const controller = require('../controllers/newPatientFormController');

// Submit New Patient Intake form -> stores as a Tebra document in the patient's chart
router.post('/new-form', auth, express.json({ limit: '2mb' }), controller.submit);

module.exports = router;
