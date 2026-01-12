// backend/src/controllers/tebraAppointmentReasonController.js
const tebraService = require('../services/tebraService');

// Get appointment reasons
exports.getAppointmentReasons = async (req, res) => {
  try {
    const { practiceId } = req.body;
    const { clientLocation } = req;

    console.log(`📝 [TEBRA APPOINTMENT REASONS] Getting appointment reasons for practice ${practiceId}`);

    const result = await tebraService.getAppointmentReasons(practiceId);

    res.json({
      success: true,
      message: 'Appointment reasons retrieved successfully',
      appointmentReasons: result.appointmentReasons || [],
      totalCount: result.totalCount || 0,
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra get appointment reasons error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointment reasons',
      error: error.message,
      location: req.clientLocation
    });
  }
};
