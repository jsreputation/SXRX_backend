// backend/src/controllers/shopifyRegistrationController.js
const { getFormattedLocation } = require('../utils/locationUtils');
const tebraService = require('../services/tebraService');
const shopifyUserService = require('../services/shopifyUserService');


// Main Shopify registration endpoint
exports.shopifyRegister = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { email, password, firstName, lastName, state, role, phone } = req.body;

    console.log(`🛍️ [SHOPIFY REGISTER] User registration via Shopify from ${getFormattedLocation(clientLocation)}`);

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !state) {
      return res.status(400).json({
        message: 'Missing required fields: email, password, firstName, lastName, state',
        location: clientLocation
      });
    }

    // Check if customer already exists in Shopify
    const existingCustomer = await shopifyUserService.findCustomerByEmail(email);
    if (existingCustomer) {
      return res.status(400).json({
        message: 'User already exists',
        location: clientLocation
      });
    }

    // Create customer in Shopify
    let shopifyCustomer = null;
    try {
      shopifyCustomer = await shopifyUserService.createCustomer({
        email,
        password,
        firstName,
        lastName,
        state,
        role: role || 'patient',
        phone: phone || ''
      });
      console.log(`✅ Shopify customer created: ${shopifyCustomer.id}`);
    } catch (shopifyError) {
      console.error('Shopify customer creation failed:', shopifyError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create customer in Shopify',
        error: shopifyError.message,
        location: clientLocation
      });
    }

    // Create patient in Tebra
    let tebraPatient = null;
    try {
      const tebraData = await tebraService.createPatient({
        firstName,
        lastName,
        email,
        phone: phone || '',
        state,
        role: role || 'patient'
      });
      
      // Update Shopify customer with Tebra patient ID
      await shopifyUserService.updateCustomerMetafields(shopifyCustomer.id, {
        tebra_patient_id: tebraData.id,
        tebra_sync_status: 'synced'
      });
      
      tebraPatient = {
        id: tebraData.id,
        syncStatus: 'synced',
        syncDate: new Date().toISOString()
      };
      console.log(`✅ Tebra patient created: ${tebraData.id}`);
    } catch (tebraError) {
      console.error('Tebra patient creation failed:', tebraError);
      
      // Update Shopify customer with failed sync status
      await shopifyUserService.updateCustomerMetafields(shopifyCustomer.id, {
        tebra_sync_status: 'failed'
      });
      
      tebraPatient = {
        syncStatus: 'failed',
        error: tebraError.message
      };
      // Continue with registration even if Tebra fails
    }

    // Generate JWT token
    const token = shopifyUserService.generateToken(shopifyCustomer, {
      role: role || 'patient',
      state: state
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: shopifyCustomer.id,
        email: shopifyCustomer.email,
        firstName: shopifyCustomer.first_name,
        lastName: shopifyCustomer.last_name,
        role: role || 'patient',
        state: state,
        phone: shopifyCustomer.phone
      },
      shopify: {
        customerId: shopifyCustomer.id,
        email: shopifyCustomer.email,
        tags: shopifyCustomer.tags
      },
      tebra: tebraPatient,
      location: clientLocation,
      message: `User registered with Shopify and Tebra integration from ${getFormattedLocation(clientLocation)}`
    });

  } catch (error) {
    console.error('Shopify registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Get Shopify customer data
exports.getShopifyCustomer = async (req, res) => {
  try {
    const { email } = req.params;
    const { clientLocation } = req;

    console.log(`🔍 [SHOPIFY GET CUSTOMER] Looking up customer: ${email}`);

    const customer = await shopifyUserService.findCustomerByEmail(email);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found in Shopify',
        location: clientLocation
      });
    }

    // Get customer metafields
    const metafields = await shopifyUserService.getCustomerMetafields(customer.id);

    res.json({
      success: true,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        phone: customer.phone,
        tags: customer.tags,
        state: metafields.state,
        role: metafields.role,
        tebraPatientId: metafields.tebra_patient_id,
        tebraSyncStatus: metafields.tebra_sync_status,
        createdAt: customer.created_at,
        updatedAt: customer.updated_at
      },
      location: clientLocation
    });

  } catch (error) {
    console.error('Get Shopify customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get customer data',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Health check for Shopify integration
exports.shopifyHealthCheck = async (req, res) => {
  try {
    const { clientLocation } = req;
    
    // Test Shopify connection by getting all SXRX customers
    const customers = await shopifyUserService.getAllSxrxCustomers();
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      stats: {
        totalSxrxCustomers: customers.length
      },
      location: clientLocation,
      message: 'Shopify integration is working'
    });

  } catch (error) {
    console.error('Shopify health check error:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      location: req.clientLocation,
      message: 'Shopify integration is not working'
    });
  }
};
