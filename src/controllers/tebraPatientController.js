// backend/src/controllers/tebraPatientController.js
const tebraService = require('../services/tebraService');
const shopifyUserService = require('../services/shopifyUserService');
const { getFormattedLocation } = require('../utils/locationUtils');

// Create a new patient in Tebra
exports.createTebraPatient = async (req, res) => {
  try {
    const { clientLocation } = req;
    // Extract patient data from the nested structure
    const patientDataFromBody = req.body.patientData || req.body;
    
    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      mobilePhone, 
      dateOfBirth, 
      gender, 
      ssn, 
      address, 
      state,
      externalId,
      practice,
      practiceName 
    } = patientDataFromBody;

    // Extract state from address object if not provided directly
    const finalState = state || address?.state;

    // Handle nested practice object
    const finalPracticeName = practiceName || practice?.practiceName;

    console.log(`🏥 [TEBRA CREATE PATIENT] Creating patient from ${getFormattedLocation(clientLocation)}`);
    console.log('🔍 Raw request body:', JSON.stringify(req.body, null, 2));
    console.log('🔍 Patient data from body:', JSON.stringify(patientDataFromBody, null, 2));
    console.log('🔍 Extracted fields:', {
      firstName: firstName || 'undefined',
      lastName: lastName || 'undefined', 
      email: email || 'undefined',
      phone: phone || 'undefined',
      mobilePhone: mobilePhone || 'undefined',
      dateOfBirth: dateOfBirth || 'undefined',
      gender: gender || 'undefined',
      ssn: ssn || 'undefined',
      address: address ? 'Present' : 'undefined',
      state: state || 'undefined',
      addressState: address?.state || 'undefined',
      finalState: finalState || 'undefined',
      externalId: externalId || 'undefined',
      practiceName: finalPracticeName || 'undefined'
    });

    // Validate required fields
    if (!firstName || !lastName || !email) {
      console.error('❌ Missing required fields:', {
        firstName: !!firstName,
        lastName: !!lastName,
        email: !!email
      });
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: firstName, lastName, email',
        location: clientLocation,
        received: {
          firstName: !!firstName,
          lastName: !!lastName,
          email: !!email
        }
      });
    }

    // Build patient data
    const patientData = {
      firstName,
      lastName,
      email,
      phone: phone || '',
      mobilePhone: mobilePhone || '',
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      ssn: ssn || null,
      state: finalState || null,
      externalId: externalId || null,
      practiceName: finalPracticeName || null,
      address: address ? {
        street: address.street || '',
        city: address.city || '',
        zipCode: address.zipCode || '',
        country: address.country || 'US'
      } : null
    };

    // Create patient in Tebra
    const tebraData = await tebraService.createPatient(patientData);
    
    console.log(`✅ Tebra patient created: ${tebraData.id}`);

    res.status(201).json({
      success: true,
      message: 'Patient created successfully in Tebra',
      patient: {
        id: tebraData.id,
        firstName: patientData.firstName,
        lastName: patientData.lastName,
        email: patientData.email,
        phone: patientData.phone,
        mobilePhone: patientData.mobilePhone,
        state: patientData.state,
        practiceName: patientData.practiceName,
        externalId: patientData.externalId
      },
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra patient creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create patient in Tebra',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Create Tebra patient from existing Shopify customer
exports.createTebraPatientFromCustomer = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { customerId } = req.params;

    console.log(`👤 [TEBRA CREATE FROM CUSTOMER] Creating Tebra patient for customer: ${customerId}`);

    // Get customer with metafields
    const customer = await shopifyUserService.getCustomerWithMetafields(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
        location: clientLocation
      });
    }

    // Check if customer already has Tebra patient ID
    if (customer.metafields.tebra_patient_id) {
      return res.status(400).json({
        success: false,
        message: 'Customer already has Tebra patient ID',
        tebraPatientId: customer.metafields.tebra_patient_id,
        location: clientLocation
      });
    }

    // Create patient in Tebra using customer data
    const tebraData = await tebraService.createPatient({
      firstName: customer.first_name,
      lastName: customer.last_name,
      email: customer.email,
      phone: customer.phone,
      state: customer.metafields.state,
      role: customer.metafields.role
    });
    
    // Update customer metafields with Tebra patient ID
    await shopifyUserService.updateCustomerMetafields(customerId, {
      tebra_patient_id: tebraData.id,
      tebra_sync_status: 'synced'
    });

    console.log(`✅ Tebra patient created for customer ${customerId}: ${tebraData.id}`);

    res.status(201).json({
      success: true,
      message: 'Tebra patient created successfully from customer',
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        state: customer.metafields.state,
        role: customer.metafields.role
      },
      tebraPatient: {
        id: tebraData.id,
        syncStatus: 'synced',
        syncDate: new Date().toISOString()
      },
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra patient creation from customer error:', error);
    
    // Update customer sync status to failed if customer exists
    if (req.params.customerId) {
      try {
        await shopifyUserService.updateCustomerMetafields(req.params.customerId, {
          tebra_sync_status: 'failed'
        });
      } catch (saveError) {
        console.error('Failed to update customer sync status:', saveError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create Tebra patient from customer',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Get Tebra patient data
exports.getTebraPatient = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { patientId } = req.params;

    console.log(`🔍 [TEBRA GET PATIENT] Getting patient: ${patientId}`);

    const patientData = await tebraService.getPatient(patientId);

    res.json({
      success: true,
      patient: patientData,
      location: clientLocation
    });

  } catch (error) {
    console.error('Get Tebra patient error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get patient data from Tebra',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Update Tebra patient
exports.updateTebraPatient = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { patientId } = req.params;
    const updateData = req.body;

    console.log(`✏️ [TEBRA UPDATE PATIENT] Updating patient: ${patientId}`);

    const updatedPatient = await tebraService.updatePatient(patientId, updateData);

    res.json({
      success: true,
      message: 'Patient updated successfully in Tebra',
      patient: updatedPatient,
      location: clientLocation
    });

  } catch (error) {
    console.error('Update Tebra patient error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update patient in Tebra',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Get all Tebra patients
exports.getTebraPatients = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { 
      practiceId, 
      batchSize = 100, 
      startKey 
    } = req.query;

    console.log(`📋 [TEBRA GET PATIENTS] Getting patients list`);

    const options = {
      practiceId: practiceId || undefined,
      batchSize: parseInt(batchSize) || 100,
      startKey: startKey || undefined
    };

    const result = await tebraService.getPatients(options);

    res.json({
      success: true,
      message: 'Patients retrieved successfully',
      data: result,
      location: clientLocation
    });

  } catch (error) {
    console.error('Get Tebra patients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve patients from Tebra',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Search patients
exports.searchPatients = async (req, res) => {
  try {
    const { searchOptions } = req.body;
    const { clientLocation } = req;

    console.log(`🔍 [TEBRA SEARCH PATIENTS] Searching patients`, searchOptions);

    const result = await tebraService.searchPatients(searchOptions);

    res.json({
      success: true,
      message: 'Patients search completed',
      patients: result.patients || [],
      totalCount: result.totalCount || 0,
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra search patients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search patients',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Test Tebra connection
exports.testTebraConnection = async (req, res) => {
  try {
    const { clientLocation } = req;

    console.log(`🔗 [TEBRA TEST CONNECTION] Testing Tebra connection`);

    const connectionTest = await tebraService.testConnection();

    res.json({
      success: true,
      message: 'Tebra connection test completed',
      connection: connectionTest,
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra connection test error:', error);
    res.status(500).json({
      success: false,
      message: 'Tebra connection test failed',
      error: error.message,
      location: req.clientLocation
    });
  }
};
