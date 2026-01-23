// backend/src/routes/tebraPatient.js
const express = require('express');
const router = express.Router();
const tebraPatientController = require('../controllers/tebraPatientController');
const { auth, authorize } = require('../middleware/shopifyTokenAuth');

/**
 * @swagger
 * /api/tebra-patient/create:
 *   post:
 *     summary: Create a new patient in Tebra
 *     tags: [Patients]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - patientData
 *             properties:
 *               patientData:
 *                 type: object
 *                 required:
 *                   - firstName
 *                   - lastName
 *                   - email
 *                 properties:
 *                   firstName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   email:
 *                     type: string
 *                     format: email
 *                   phone:
 *                     type: string
 *                   mobilePhone:
 *                     type: string
 *                   dateOfBirth:
 *                     type: string
 *                     format: date
 *                   gender:
 *                     type: string
 *                   state:
 *                     type: string
 *                   address:
 *                     type: object
 *     responses:
 *       201:
 *         description: Patient created successfully
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Failed to create patient
 */
// Create a new patient in Tebra
router.post('/create', auth, tebraPatientController.createTebraPatient);

/**
 * @swagger
 * /api/tebra-patient/create-from-customer/{customerId}:
 *   post:
 *     summary: Create Tebra patient from existing Shopify customer
 *     tags: [Patients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Patient created from customer successfully
 *       400:
 *         description: Customer already has Tebra patient ID
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Failed to create patient
 */
// Create Tebra patient from existing customer
router.post('/create-from-customer/:customerId', auth, tebraPatientController.createTebraPatientFromCustomer);

/**
 * @swagger
 * /api/tebra-patient/{patientId}:
 *   get:
 *     summary: Get Tebra patient data by ID
 *     tags: [Patients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: patientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Patient data retrieved successfully
 *       500:
 *         description: Failed to get patient
 */
// Get Tebra patient data
router.get('/:patientId', auth, tebraPatientController.getTebraPatient);

/**
 * @swagger
 * /api/tebra-patient/{patientId}:
 *   put:
 *     summary: Update Tebra patient data
 *     tags: [Patients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: patientId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               address:
 *                 type: object
 *     responses:
 *       200:
 *         description: Patient updated successfully
 *       500:
 *         description: Failed to update patient
 */
// Update Tebra patient
router.put('/:patientId', auth, tebraPatientController.updateTebraPatient);

/**
 * @swagger
 * /api/tebra-patient:
 *   get:
 *     summary: Get all Tebra patients (paginated)
 *     tags: [Patients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: practiceId
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Patients retrieved successfully
 *       500:
 *         description: Failed to get patients
 */
// Get all Tebra patients
router.get('/', auth, tebraPatientController.getTebraPatients);

/**
 * @swagger
 * /api/tebra-patient/search:
 *   post:
 *     summary: Search patients with filters
 *     tags: [Patients]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Patients found
 *       500:
 *         description: Failed to search patients
 */
// Search patients
router.post('/search', auth, tebraPatientController.searchPatients);

/**
 * @swagger
 * /api/tebra-patient/test/connection:
 *   get:
 *     summary: Test Tebra connection (public endpoint for initialization)
 *     tags: [Patients]
 *     responses:
 *       200:
 *         description: Connection test result
 *       500:
 *         description: Connection test failed
 */
// Test Tebra connection (public for initialization)
router.get('/test/connection', tebraPatientController.testTebraConnection);

module.exports = router;
