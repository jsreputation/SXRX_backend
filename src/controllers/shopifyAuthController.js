// backend/src/controllers/shopifyAuthController.js
const { getFormattedLocation } = require('../utils/locationUtils');
const shopifyUserService = require('../services/shopifyUserService');

// Login with Shopify customer
exports.shopifyLogin = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { email, password } = req.body;

    console.log(`🔐 [SHOPIFY LOGIN] Login attempt from ${getFormattedLocation(clientLocation)}`);

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
        location: clientLocation
      });
    }

    // Find customer in Shopify
    const customer = await shopifyUserService.findCustomerByEmail(email);
    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        location: clientLocation
      });
    }

    // Verify password
    const isValidPassword = await shopifyUserService.verifyPassword(customer, password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        location: clientLocation
      });
    }

    // Get customer metafields
    const metafields = await shopifyUserService.getCustomerMetafields(customer.id);

    // Generate JWT token
    const token = shopifyUserService.generateToken(customer, metafields);

    res.json({
      success: true,
      token,
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        role: metafields.role || 'patient',
        state: metafields.state || 'CA',
        phone: customer.phone,
        tebraPatientId: metafields.tebra_patient_id,
        tebraSyncStatus: metafields.tebra_sync_status
      },
      location: clientLocation,
      message: `User logged in from ${getFormattedLocation(clientLocation)}`
    });

  } catch (error) {
    console.error('Shopify login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Get current user profile
exports.getCurrentUser = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { customerId } = req.user;

    console.log(`👤 [SHOPIFY GET USER] Profile accessed from ${getFormattedLocation(clientLocation)}`);

    // Get customer with metafields
    const customer = await shopifyUserService.getCustomerWithMetafields(customerId);

    res.json({
      success: true,
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        role: customer.metafields.role || 'patient',
        state: customer.metafields.state || 'CA',
        phone: customer.phone,
        tebraPatientId: customer.metafields.tebra_patient_id,
        tebraSyncStatus: customer.metafields.tebra_sync_status,
        tags: customer.tags,
        createdAt: customer.created_at,
        updatedAt: customer.updated_at
      },
      location: clientLocation,
      message: `Profile accessed from ${getFormattedLocation(clientLocation)}`
    });

  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Update user profile
exports.updateUserProfile = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { customerId } = req.user;
    const { firstName, lastName, phone, state } = req.body;

    console.log(`✏️ [SHOPIFY UPDATE USER] Profile update from ${getFormattedLocation(clientLocation)}`);

    // Update customer basic info
    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (phone) updateData.phone = phone;

    const updatedCustomer = await shopifyUserService.updateCustomer(customerId, updateData);

    // Update metafields if state is provided
    if (state) {
      await shopifyUserService.updateCustomerMetafields(customerId, {
        state: state
      });
    }

    // Get updated customer with metafields
    const customer = await shopifyUserService.getCustomerWithMetafields(customerId);

    res.json({
      success: true,
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        role: customer.metafields.role || 'patient',
        state: customer.metafields.state || 'CA',
        phone: customer.phone,
        tebraPatientId: customer.metafields.tebra_patient_id,
        tebraSyncStatus: customer.metafields.tebra_sync_status
      },
      location: clientLocation,
      message: `Profile updated from ${getFormattedLocation(clientLocation)}`
    });

  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { customerId } = req.user;
    const { currentPassword, newPassword } = req.body;

    console.log(`🔑 [SHOPIFY CHANGE PASSWORD] Password change from ${getFormattedLocation(clientLocation)}`);

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
        location: clientLocation
      });
    }

    // Get customer
    const customer = await shopifyUserService.findCustomerByEmail(req.user.email);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
        location: clientLocation
      });
    }

    // Verify current password
    const isValidPassword = await shopifyUserService.verifyPassword(customer, currentPassword);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
        location: clientLocation
      });
    }

    // Hash new password
    const bcrypt = require('bcryptjs');
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password in metafields
    await shopifyUserService.updateCustomerMetafields(customerId, {
      password: hashedNewPassword
    });

    res.json({
      success: true,
      message: 'Password changed successfully',
      location: clientLocation
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Logout (client-side token removal)
exports.shopifyLogout = async (req, res) => {
  try {
    const { clientLocation } = req;
    
    console.log(`🚪 [SHOPIFY LOGOUT] User logout from ${getFormattedLocation(clientLocation)}`);
    
    res.json({
      success: true,
      message: 'Logged out successfully',
      location: clientLocation
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message,
      location: req.clientLocation
    });
  }
};
