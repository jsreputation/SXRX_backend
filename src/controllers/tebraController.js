// backend/src/controllers/tebraController.js
const tebraService = require('../services/tebraService');

// Note: Methods that used deprecated User model have been removed
// Use tebra-patient routes instead for patient operations

exports.getTebraPatients = async (req, res) => {
  try {
    const { 
      practiceId, 
      batchSize = 100, 
      startKey 
    } = req.query;

    const options = {
      practiceId: practiceId || undefined,
      batchSize: parseInt(batchSize) || 100,
      startKey: startKey || undefined
    };

    const result = await tebraService.getPatients(options);

    res.json({
      message: 'Patients retrieved successfully',
      data: result
    });
  } catch (error) {
    console.error('Tebra get all patients error:', error);
    res.status(500).json({ message: 'Failed to retrieve patients from Tebra' });
  }
};

// Test Tebra connection
exports.testTebraConnection = async (req, res) => {
  try {
    console.log('🔗 [TEBRA TEST CONNECTION] Testing Tebra connection');
    
    const connectionTest = await tebraService.testConnection();

    res.json({
      success: connectionTest.success,
      message: 'Tebra connection test completed',
      mode: connectionTest.mode,
      error: connectionTest.error
    });

  } catch (error) {
    console.error('Tebra connection test error:', error);
    res.status(500).json({
      success: false,
      message: 'Tebra connection test failed',
      error: error.message
    });
  }
};