// backend/src/routes/tebraPatient.js
const express = require('express');
const router = express.Router();
const tebraPatientController = require('../controllers/tebraPatientController');
const { auth, authorize } = require('../middleware/shopifyTokenAuth');

// Create a new patient in Tebra
router.post('/create', auth, tebraPatientController.createTebraPatient);

// Create Tebra patient from existing customer
router.post('/create-from-customer/:customerId', auth, tebraPatientController.createTebraPatientFromCustomer);

// Get Tebra patient data
router.get('/:patientId', auth, tebraPatientController.getTebraPatient);

// Update Tebra patient
router.put('/:patientId', auth, tebraPatientController.updateTebraPatient);

// Get all Tebra patients
router.get('/', auth, tebraPatientController.getTebraPatients);

// Search patients
router.post('/search', auth, tebraPatientController.searchPatients);

// Test Tebra connection (public for initialization)
router.get('/test/connection', tebraPatientController.testTebraConnection);

module.exports = router;
