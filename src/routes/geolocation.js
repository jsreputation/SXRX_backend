const express = require('express');
const router = express.Router();

// Route to get current client location
router.get('/my-location', (req, res) => {
  res.json({
    success: true,
    location: req.clientLocation
  });
});

// Route to get doctors near client's location
router.get('/doctors-nearby', (req, res) => {
  const { clientLocation } = req;
  
  if (!clientLocation || clientLocation.error || clientLocation.isLocal) {
    return res.status(400).json({
      success: false,
      message: 'Unable to determine your location. Please provide your location manually.'
    });
  }

  // You can use the location data to find nearby doctors
  // For example, filter doctors by state/region
  res.json({
    success: true,
    message: `Finding doctors near ${clientLocation.city}, ${clientLocation.region}`,
    location: clientLocation,
    // You would typically query your database here
    // const nearbyDoctors = await Doctor.find({ state: clientLocation.regionCode });
  });
});

module.exports = router; 