// backend/src/services/tebraServiceSingleton.js
// Singleton wrapper for TebraService to ensure single instance across the application

// Import the module to access both instance and class
const tebraServiceModule = require('./tebraService');
const TebraService = tebraServiceModule.TebraService;

// Verify TebraService is a constructor
if (!TebraService || typeof TebraService !== 'function') {
  console.error('tebraServiceModule keys:', Object.keys(tebraServiceModule || {}));
  console.error('TebraService value:', TebraService, 'type:', typeof TebraService);
  throw new Error('TebraService is not a constructor. Check tebraService.js exports.');
}

let tebraServiceInstance = null;

/**
 * Get or create the singleton TebraService instance
 * @returns {TebraService} Singleton instance
 */
function getTebraService() {
  if (!tebraServiceInstance) {
    tebraServiceInstance = new TebraService();
  }
  return tebraServiceInstance;
}

module.exports = getTebraService;

