// backend/src/services/tebraServiceSingleton.js
// Singleton wrapper for TebraService to ensure single instance across the application

// Import the class, not the instance
const { TebraService } = require('./tebraService');

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

