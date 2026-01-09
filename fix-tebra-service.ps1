# PowerShell script to create the fixed file content
# This shows what needs to be changed on the server

Write-Host "🔧 TebraService Import Fix" -ForegroundColor Cyan
Write-Host ""

$fixedContent = @"
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
"@

Write-Host "Fixed file content:" -ForegroundColor Yellow
Write-Host $fixedContent
Write-Host ""
Write-Host "To apply on server:" -ForegroundColor Green
Write-Host "1. Upload this file to: /var/www/sxrx-backend/src/services/tebraServiceSingleton.js"
Write-Host "2. Run: pm2 restart sxrx-backend"
Write-Host "3. Check: pm2 logs sxrx-backend"

