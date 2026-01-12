// backend/src/middleware/shopifyAuth.js
const jwt = require('jsonwebtoken');
const shopifyUserService = require('../services/shopifyUserService');

// Middleware to authenticate Shopify customers
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided, authorization denied'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify customer still exists in Shopify
    const customer = await shopifyUserService.findCustomerByEmail(decoded.email);
    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Customer not found, token invalid'
      });
    }

    // Add customer info to request
    req.user = {
      customerId: decoded.customerId,
      email: decoded.email,
      role: decoded.role,
      state: decoded.state
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
};

// Middleware to authorize specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied, no user found'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied, role '${req.user.role}' not authorized`
      });
    }

    next();
  };
};

module.exports = { auth, authorize };
