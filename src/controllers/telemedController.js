// backend/src/controllers/telemedController.js
// Telemedicine scheduling integrated with Tebra (minimal viable)

const tebraService = require('../services/tebraService');
const { selectProvider } = require('../services/providerRoutingService');

exports.bookAppointment = async (req, res) => {
  try {
    const { preferredWindow, reason, product, patient = {} } = req.body || {};

    // Determine provider by state (from patient)
    const stateInput = patient?.address?.state || patient?.state || null;
    const routing = selectProvider({ stateInput });

    // Ensure patient exists in Tebra
    let tebraPatientId = patient?.id || null;
    try {
      if (!tebraPatientId && (patient.email || patient.patientEmail)) {
        const email = patient.email || patient.patientEmail;
        try {
          const found = await tebraService.searchPatients({ email });
          const candidates = found?.patients || found?.Patients || [];
          const match = candidates.find(p => (p.Email || p.email || '').toLowerCase() === String(email).toLowerCase());
          const id = match?.ID || match?.Id || match?.id;
          if (id) tebraPatientId = id;
        } catch {}
        if (!tebraPatientId) {
          const created = await tebraService.createPatient({
            email,
            firstName: patient.firstName || 'Unknown',
            lastName: patient.lastName || 'Unknown',
            mobilePhone: patient.phone,
            practice: routing.practiceId ? { PracticeID: routing.practiceId } : undefined,
          });
          tebraPatientId = created?.id || created?.patientId || created?.PatientID || null;
        }
      }
    } catch (e) {
      console.warn('telemed: ensure patient failed:', e?.message || e);
    }

    if (!tebraPatientId) {
      return res.status(400).json({ success: false, message: 'Unable to ensure patient in Tebra for scheduling' });
    }

    // Build desired appointment slot
    const start = preferredWindow?.start ? new Date(preferredWindow.start) : new Date(Date.now() + 60 * 60 * 1000);
    const end = preferredWindow?.end ? new Date(preferredWindow.end) : new Date(start.getTime() + 15 * 60 * 1000);

    // Create appointment in Tebra
    let createdAppt = null;
    try {
      const apptReq = {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        patientId: tebraPatientId,
        reason: reason || product || 'Telemedicine Consultation',
        practiceId: routing.practiceId || undefined,
      };
      createdAppt = await tebraService.createAppointment(apptReq);
    } catch (e) {
      console.error('telemed: createAppointment failed:', e?.message || e);
      return res.status(500).json({ success: false, message: 'Failed to create appointment in Tebra' });
    }

    // Generate meeting link (placeholder) and attach as a document/note
    const meetingLink = `https://meet.sxrx.us/${Math.random().toString(36).slice(2, 10)}`;
    try {
      await tebraService.createDocument({
        name: 'Telemedicine Meeting Link',
        fileName: `meeting-${Date.now()}.txt`,
        label: 'Telemedicine',
        patientId: tebraPatientId,
        fileContent: Buffer.from(meetingLink, 'utf8').toString('base64'),
        status: 'Completed',
      });
    } catch (e) {
      console.warn('telemed: failed to store meeting link document:', e?.message || e);
    }

    // Create a minimal New Patient Form document if indicated
    try {
      if (req.body?.includeNewPatientForm) {
        const formPayload = {
          type: 'New Patient Form',
          submittedAt: new Date().toISOString(),
          provided: req.body?.newPatientForm || {},
        };
        await tebraService.createDocument({
          name: 'New Patient Form',
          fileName: `new-patient-form-${Date.now()}.json`,
          label: 'Intake',
          patientId: tebraPatientId,
          fileContent: Buffer.from(JSON.stringify(formPayload)).toString('base64'),
          status: 'Completed',
        });
      }
    } catch (e) {
      console.warn('telemed: failed to store new patient form:', e?.message || e);
    }

    // Persist encounter linkage
    try {
      const { createOrUpdate } = require('../services/encounterService');
      const appointmentId = createdAppt?.id || createdAppt?.appointmentId || createdAppt?.AppointmentID || null;
      await createOrUpdate({ tebraPatientId, appointmentId, status: 'appointment_booked' });
    } catch (e) {
      console.warn('telemed: encounter persistence failed:', e?.message || e);
    }

    res.json({
      success: true,
      appointment: {
        id: createdAppt?.id || createdAppt?.appointmentId || `appt_${Date.now()}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        reason: reason || product || 'Telemedicine Consultation',
        meetingLink,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to book telemed appointment', error: error.message });
  }
};
