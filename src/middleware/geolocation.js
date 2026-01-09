const axios = require('axios');

// Cache for IP lookups to avoid repeated API calls
const ipCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Get client's IP address from request
const getClientIP = (req) => {
  // Try to get IP from various headers (for different deployment scenarios)
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.connection.remoteAddress || 
             req.socket.remoteAddress ||
             (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
             req.ip;

  // Clean up the IP (remove IPv6 prefix if present)
  return ip ? ip.replace(/^::ffff:/, '') : null;
};

// Get location from IP using IP-API
const getLocationFromIP = async (ip) => {
  try {
    // Check cache first
    const cached = ipCache.get(ip);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return cached.data;
    }

    const response = await axios.get(`http://ip-api.com/json/${ip}`);
    
    if (response.data.status === 'success') {
      const locationData = {
        country: response.data.country,
        countryCode: response.data.countryCode,
        region: response.data.regionName,
        regionCode: response.data.region,
        city: response.data.city,
        zip: response.data.zip,
        lat: response.data.lat,
        lon: response.data.lon,
        timezone: response.data.timezone,
        isp: response.data.isp,
        org: response.data.org,
        as: response.data.as,
        query: response.data.query
      };

      // Cache the result
      ipCache.set(ip, {
        data: locationData,
        timestamp: Date.now()
      });

      return locationData;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error getting location from IP:', error);
    return null;
  }
};

// Middleware to attach client location to request
const geolocationMiddleware = async (req, res, next) => {
  try {
    const clientIP = getClientIP(req);
    
    if (clientIP) {
      // Skip localhost/private IPs
      if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP.startsWith('192.168.') || clientIP.startsWith('10.')) {
        req.clientLocation = {
          ip: clientIP,
          isLocal: true,
          country: 'Local',
          city: 'Local'
        };
      } else {
        const location = await getLocationFromIP(clientIP);
        req.clientLocation = {
          ip: clientIP,
          isLocal: false,
          ...location
        };
      }
    } else {
      req.clientLocation = {
        ip: null,
        error: 'Could not determine client IP'
      };
    }

    // Log location data for every request
    console.log('🌍 [GEOLOCATION]', {
      method: req.method,
      url: req.url,
      ip: req.clientLocation.ip,
      location: req.clientLocation.isLocal ? 'Local/Private IP' : `${req.clientLocation.city}, ${req.clientLocation.region}, ${req.clientLocation.country}`,
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Geolocation middleware error:', error);
    req.clientLocation = {
      ip: getClientIP(req),
      error: 'Failed to get location data'
    };
    
    // Log error case
    console.log('❌ [GEOLOCATION ERROR]', {
      method: req.method,
      url: req.url,
      ip: req.clientLocation.ip,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
  
  next();
};

module.exports = geolocationMiddleware; 