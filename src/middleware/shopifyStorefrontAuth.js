// backend/src/middleware/shopifyStorefrontAuth.js
const jwt = require('jsonwebtoken');

// Middleware to authenticate Shopify Storefront customers
const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    console.log('🔍 Auth header received:', authHeader ? 'Present' : 'Missing');
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'No authorization header provided'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('🔍 Token extracted:', token ? `${token.substring(0, 20)}...` : 'Empty');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided, authorization denied'
      });
    }

    // Check if JWT_SECRET is configured
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET is not configured');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    console.log('🔍 JWT_SECRET configured:', process.env.JWT_SECRET ? 'Yes' : 'No');

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('🔍 Token decoded successfully:', { 
      customerId: decoded.customerId, 
      email: decoded.email,
      role: decoded.role 
    });
    
    // Check if token contains Shopify customer info
    if (!decoded.customerId || !decoded.email) {
      console.error('❌ Token missing required fields:', { 
        hasCustomerId: !!decoded.customerId, 
        hasEmail: !!decoded.email 
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid token format - missing customer information'
      });
    }

    // Add customer info to request
    req.user = {
      customerId: decoded.customerId,
      email: decoded.email,
      role: decoded.role || 'customer',
      shopifyAccessToken: decoded.shopifyAccessToken
    };

    console.log('✅ Authentication successful for customer:', decoded.email);
    next();
  } catch (error) {
    console.error('❌ Shopify Storefront auth middleware error:', error.message);
    console.error('❌ Error type:', error.name);
    
    // Provide more specific error messages
    let errorMessage = 'Token is not valid';
    if (error.name === 'JsonWebTokenError') {
      if (error.message.includes('malformed')) {
        errorMessage = 'Token format is invalid';
      } else if (error.message.includes('invalid signature')) {
        errorMessage = 'Token signature is invalid';
      } else if (error.message.includes('jwt must be provided')) {
        errorMessage = 'No token provided';
      }
    } else if (error.name === 'TokenExpiredError') {
      errorMessage = 'Token has expired';
    } else if (error.name === 'NotBeforeError') {
      errorMessage = 'Token not active yet';
    }
    
    res.status(401).json({
      success: false,
      message: errorMessage,
      error: error.name
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
