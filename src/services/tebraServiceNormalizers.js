// backend/src/services/tebraServiceNormalizers.js

module.exports = {
  normalizeCreatePatientResponse(result) {
    const data = this.unwrap(result);
    const id = data.PatientID || data.id || data.patientId;
    return { id };
  },

  normalizeGetPatientResponse(result) {
    const data = this.unwrap(result);

    if (data.Patients && Array.isArray(data.Patients) && data.Patients.length > 0) {
      return this.normalizePatientData(data.Patients[0]);
    } else if (Array.isArray(data) && data.length > 0) {
      return this.normalizePatientData(data[0]);
    }
    return this.normalizePatientData(data);
  },

  normalizeGetPatientsResponse(result) {
    const data = this.unwrap(result);

    if (data.Patients && Array.isArray(data.Patients)) {
      return {
        patients: data.Patients.map(patient => this.normalizePatientData(patient)),
        totalCount: data.TotalCount || data.Patients.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        patients: data.map(patient => this.normalizePatientData(patient)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    }
    return {
      patients: [this.normalizePatientData(data)],
      totalCount: 1,
      hasMore: false,
      nextStartKey: null
    };
  },

  normalizePatientData(patient) {
    return {
      id: patient.ID || patient.PatientID || patient.id,
      first_name: patient.FirstName || patient.first_name,
      last_name: patient.LastName || patient.last_name,
      full_name: patient.PatientFullName || patient.full_name,
      email: patient.EmailAddress || patient.email,
      home_phone: patient.HomePhone || patient.home_phone,
      mobile_phone: patient.MobilePhone || patient.mobile_phone,
      work_phone: patient.WorkPhone || patient.work_phone,
      date_of_birth: patient.DOB || patient.DateOfBirth || patient.date_of_birth,
      gender: patient.Gender || patient.gender,
      ssn: patient.SSN || patient.ssn,
      medical_record_number: patient.MedicalRecordNumber || patient.medical_record_number,
      address: {
        street: patient.AddressLine1 || patient.address?.street,
        city: patient.City || patient.address?.city,
        state: patient.State || patient.address?.state,
        zip_code: patient.ZipCode || patient.address?.zip_code,
        country: patient.Country || patient.address?.country
      },
      emergency_contact: {
        name: patient.EmergencyName || patient.emergency_contact?.name,
        phone: patient.EmergencyPhone || patient.emergency_contact?.phone
      },
      insurance: {
        primary: {
          company_name: patient.PrimaryInsurancePolicyCompanyName,
          policy_number: patient.PrimaryInsurancePolicyNumber,
          plan_name: patient.PrimaryInsurancePolicyPlanName
        },
        secondary: {
          company_name: patient.SecondaryInsurancePolicyCompanyName,
          policy_number: patient.SecondaryInsurancePolicyNumber,
          plan_name: patient.SecondaryInsurancePolicyPlanName
        }
      },
      providers: {
        default_rendering: patient.DefaultRenderingProviderFullName,
        primary_care: patient.PrimaryCarePhysicianFullName,
        referring: patient.ReferringProviderFullName
      },
      service_location: {
        name: patient.DefaultServiceLocationName,
        id: patient.DefaultServiceLocationId
      },
      practice: {
        id: patient.PracticeId,
        name: patient.PracticeName
      },
      recent_activity: {
        last_appointment: patient.LastAppointmentDate,
        last_encounter: patient.LastEncounterDate,
        last_diagnosis: patient.LastDiagnosis
      },
      notes: {
        statement_note: patient.StatementNote,
        most_recent: {
          message: patient.MostRecentNote1Message,
          date: patient.MostRecentNote1Date,
          user: patient.MostRecentNote1User
        }
      },
      created_at: patient.CreatedDate || patient.created_at,
      updated_at: patient.LastModifiedDate || patient.updated_at
    };
  },

  _sanitizePhoneForUpdate(val) {
    if (val == null || typeof val !== 'string') return undefined;
    const s = String(val).trim();
    if (!s) return undefined;
    const lowered = s.toLowerCase();
    if (['not provided', 'n/a', 'none', '-', 'na', 'n.a.', 'n.a'].includes(lowered)) return undefined;
    const digits = s.replace(/\D/g, '');
    if (digits.length < 10) return undefined;
    return s;
  },

  cleanRequestData(obj) {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (obj[i] === null || obj[i] === undefined || obj[i] === '') {
          obj.splice(i, 1);
        } else {
          this.cleanRequestData(obj[i]);
        }
      }
    } else if (typeof obj === 'object') {
      for (const key in obj) {
        if (obj[key] === null || obj[key] === undefined || obj[key] === '') {
          delete obj[key];
        } else {
          this.cleanRequestData(obj[key]);
        }
      }
    }
  },

  normalizeCreateDocumentResponse(result) {
    const data = this.unwrap(result);
    return {
      id: data.DocumentID || data.id || data.documentId,
      name: data.Name || data.name,
      fileName: data.FileName || data.fileName,
      documentDate: data.DocumentDate || data.documentDate,
      status: data.Status || data.status,
      patientId: data.PatientId || data.patientId,
      practiceId: data.PracticeId || data.practiceId,
      created_at: data.CreatedDate || data.created_at
    };
  },

  normalizeGetAppointmentsResponse(result, requestingPatientId = null) {
    const data = this.unwrap(result);

    if (data.Appointments && Array.isArray(data.Appointments)) {
      return {
        appointments: data.Appointments.map(appointment => this.normalizeAppointmentData(appointment, requestingPatientId)),
        totalCount: data.TotalCount || data.Appointments.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        appointments: data.map(appointment => this.normalizeAppointmentData(appointment, requestingPatientId)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    }
    return {
      appointments: [this.normalizeAppointmentData(data, requestingPatientId)],
      totalCount: 1,
      hasMore: false,
      nextStartKey: null
    };
  },

  normalizeGetAppointmentResponse(result, requestingPatientId = null) {
    const data = this.unwrap(result);

    if (data.Appointments && Array.isArray(data.Appointments) && data.Appointments.length > 0) {
      return this.normalizeAppointmentData(data.Appointments[0], requestingPatientId);
    } else if (data.Appointment) {
      return this.normalizeAppointmentData(data.Appointment, requestingPatientId);
    } else if (Array.isArray(data) && data.length > 0) {
      return this.normalizeAppointmentData(data[0], requestingPatientId);
    } else if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return this.normalizeAppointmentData(data, requestingPatientId);
    }
    return this.normalizeAppointmentData({}, requestingPatientId);
  },

  normalizeCreateAppointmentResponse(result) {
    const data = this.unwrap(result);
    return {
      id: data.AppointmentID || data.id || data.appointmentId,
      appointmentId: data.AppointmentID || data.appointmentId,
      startTime: data.StartTime || data.startTime,
      endTime: data.EndTime || data.endTime,
      status: data.AppointmentStatus || data.status,
      patientId: data.PatientId || data.patientId,
      practiceId: data.PracticeId || data.practiceId,
      created_at: data.CreatedDate || data.created_at
    };
  },

  normalizeAppointmentData(appointment, requestingPatientId = null) {
    if (!appointment || typeof appointment !== 'object') {
      return {};
    }

    const startDateTimeRaw = appointment.StartTime || appointment.startTime;
    const endDateTimeRaw = appointment.EndTime || appointment.endTime;

    let startDate = null;
    let startTimeFormatted = null;
    let endDate = null;
    let endTimeFormatted = null;

    if (startDateTimeRaw) {
      try {
        const startDateTime = new Date(startDateTimeRaw);
        startDate = startDateTime.toISOString().split('T')[0];
        startTimeFormatted = startDateTime.toTimeString().split(' ')[0];
      } catch (error) {
        console.warn('Failed to parse start time:', startDateTimeRaw);
        startTimeFormatted = startDateTimeRaw;
      }
    }

    if (endDateTimeRaw) {
      try {
        const endDateTime = new Date(endDateTimeRaw);
        endDate = endDateTime.toISOString().split('T')[0];
        endTimeFormatted = endDateTime.toTimeString().split(' ')[0];
      } catch (error) {
        console.warn('Failed to parse end time:', endDateTimeRaw);
        endTimeFormatted = endDateTimeRaw;
      }
    }

    return {
      id: appointment.ID || appointment.AppointmentID || appointment.id || appointment.AppointmentId,
      appointmentId: appointment.ID || appointment.AppointmentID || appointment.appointmentId || appointment.AppointmentId,
      patientId: appointment.PatientID || appointment.PatientId || appointment.patientId,
      startDateTime: startDateTimeRaw || null,
      endDateTime: endDateTimeRaw || null,
      startDate: startDate,
      endDate: endDate,
      startTime: startTimeFormatted,
      endTime: endTimeFormatted,
      appointmentDuration: appointment.AppointmentDuration || appointment.appointmentDuration,
      allDay: appointment.AllDay || appointment.allDay,
      type: appointment.Type || appointment.type,
      appointmentType: appointment.AppointmentType || appointment.appointmentType,
      appointmentStatus: appointment.AppointmentStatus || appointment.appointmentStatus,
      confirmationStatus: appointment.ConfirmationStatus || appointment.confirmationStatus,
      notes: appointment.Notes || appointment.Note || appointment.notes || appointment.note,
      recurring: appointment.Recurring || appointment.recurring,
      isRecurring: appointment.IsRecurring || appointment.isRecurring,
      occurrenceId: appointment.OccurrenceID || appointment.occurrenceId,
      appointmentReasonId: appointment.AppointmentReasonID || appointment.appointmentReasonId,
      providerId: appointment.ProviderId || appointment.ProviderID || appointment.providerId,
      resourceId: appointment.ResourceID || appointment.resourceId,
      resourceIds: appointment.ResourceIDs || appointment.resourceIds,
      appointmentName: appointment.AppointmentName || appointment.appointmentName,
      wasCreatedOnline: appointment.WasCreatedOnline || appointment.wasCreatedOnline,
      insurancePolicyAuthorizationId: appointment.InsurancePolicyAuthorizationID || appointment.insurancePolicyAuthorizationId,
      isGroupAppointment: appointment.IsGroupAppointment || appointment.isGroupAppointment,
      maxAttendees: appointment.MaxAttendees || appointment.maxAttendees,
      attendeesCount: appointment.AttendeesCount || appointment.attendeesCount,
      forRecare: appointment.ForRecare || appointment.forRecare,
      createdDate: appointment.CreatedDate || appointment.createdDate,
      lastModifiedDate: appointment.LastModifiedDate || appointment.lastModifiedDate,
      patient: {
        id: appointment.PatientID || appointment.PatientId || appointment.patientId,
        fullName: (
          appointment.PatientFullName ||
          appointment.patientFullName ||
          `${(appointment.FirstName || appointment.firstName || (appointment.PatientSummary && (appointment.PatientSummary.FirstName || appointment.PatientSummary.firstName)) || (appointment.patientSummary && (appointment.patientSummary.FirstName || appointment.patientSummary.firstName)) || '').toString()} ${(appointment.LastName || appointment.lastName || (appointment.PatientSummary && (appointment.PatientSummary.LastName || appointment.PatientSummary.lastName)) || (appointment.patientSummary && (appointment.patientSummary.LastName || appointment.patientSummary.lastName)) || '').toString()}`.trim()
        ),
        firstName: appointment.FirstName || appointment.firstName || (appointment.PatientSummary && (appointment.PatientSummary.FirstName || appointment.PatientSummary.firstName)) || (appointment.patientSummary && (appointment.patientSummary.FirstName || appointment.patientSummary.firstName)),
        middleName: appointment.MiddleName || appointment.middleName,
        lastName: appointment.LastName || appointment.lastName || (appointment.PatientSummary && (appointment.PatientSummary.LastName || appointment.PatientSummary.lastName)) || (appointment.patientSummary && (appointment.patientSummary.LastName || appointment.patientSummary.lastName)),
        email: appointment.Email || appointment.email || (appointment.PatientSummary && (appointment.PatientSummary.Email || appointment.PatientSummary.email)) || (appointment.patientSummary && (appointment.patientSummary.Email || appointment.patientSummary.email)),
        homePhone: appointment.HomePhone || appointment.homePhone || (appointment.PatientSummary && (appointment.PatientSummary.HomePhone || appointment.PatientSummary.homePhone)) || (appointment.patientSummary && (appointment.patientSummary.HomePhone || appointment.patientSummary.homePhone)),
        workPhone: appointment.WorkPhone || appointment.workPhone,
        mobilePhone: appointment.MobilePhone || appointment.mobilePhone || (appointment.PatientSummary && (appointment.PatientSummary.MobilePhone || appointment.PatientSummary.mobilePhone)) || (appointment.patientSummary && (appointment.patientSummary.MobilePhone || appointment.patientSummary.mobilePhone)),
        workEmail: appointment.WorkEmail || appointment.workEmail,
        otherEmail: appointment.OtherEmail || appointment.otherEmail,
        dateOfBirth: appointment.DateOfBirth || appointment.dateOfBirth || (appointment.PatientSummary && (appointment.PatientSummary.DateOfBirth || appointment.PatientSummary.dateOfBirth)) || (appointment.patientSummary && (appointment.patientSummary.DateOfBirth || appointment.patientSummary.dateOfBirth)),
        genderId: appointment.GenderID || appointment.genderId,
        preferredPhoneType: appointment.PreferredPhoneType || appointment.preferredPhoneType,
        preferredEmailType: appointment.PreferredEmailType || appointment.preferredEmailType,
        guid: appointment.Guid || appointment.guid,
        caseId: appointment.PatientCaseID || appointment.patientCaseId,
        caseName: appointment.PatientCaseName || appointment.patientCaseName,
        casePayerScenario: appointment.PatientCasePayerScenario || appointment.patientCasePayerScenario
      },
      provider: {
        id: appointment.ProviderId || appointment.ProviderID || appointment.providerId,
        fullName: appointment.ProviderFullName || appointment.providerFullName || appointment.ProviderName || appointment.providerName
      },
      practice: {
        id: appointment.PracticeId || appointment.practiceId,
        name: appointment.PracticeName || appointment.practiceName
      },
      service_location: {
        id: appointment.ServiceLocationID || appointment.serviceLocationId,
        name: appointment.ServiceLocationName || appointment.serviceLocationName
      },
      appointment_reason: {
        id: appointment.AppointmentReasonID || appointment.AppointmentReasonId || appointment.appointmentReasonId,
        name: appointment.AppointmentReason1 || appointment.AppointmentReason || appointment.appointmentReason
      },
      meetingLink: appointment.MeetingLink || appointment.meetingLink || appointment.TelehealthMeetingLink || appointment.telehealthMeetingLink,
      mine: requestingPatientId ? String(appointment.PatientID || appointment.PatientId || appointment.patientId) === String(requestingPatientId) : undefined
    };
  },

  normalizeCreateAppointmentReasonResponse(result) {
    const data = this.unwrap(result);
    return {
      id: data.AppointmentReasonID || data.id || data.appointmentReasonId,
      name: data.Name || data.name,
      type: data.Type || data.type,
      isActive: data.Active || data.active
    };
  },

  normalizeGetAppointmentReasonsResponse(result) {
    const data = this.unwrap(result);

    if (data.AppointmentReasons && Array.isArray(data.AppointmentReasons)) {
      return {
        appointmentReasons: data.AppointmentReasons.map(reason => this.normalizeAppointmentReasonData(reason)),
        totalCount: data.TotalCount || data.AppointmentReasons.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        appointmentReasons: data.map(reason => this.normalizeAppointmentReasonData(reason)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    }
    return {
      appointmentReasons: [this.normalizeAppointmentReasonData(data)],
      totalCount: 1,
      hasMore: false,
      nextStartKey: null
    };
  },

  normalizeAppointmentReasonData(reason) {
    return {
      id: reason.ID || reason.AppointmentReasonID || reason.id || reason.appointmentReasonId,
      name: reason.Name || reason.name,
      type: reason.Type || reason.type,
      isActive: reason.Active || reason.active,
      description: reason.Description || reason.description,
      procedureCodeIds: reason.ProcedureCodeIds || reason.procedureCodeIds || [],
      appointmentReasonId: reason.AppointmentReasonID || reason.appointmentReasonId
    };
  },

  normalizeGetAvailabilityResponse(result) {
    const data = this.unwrap(result);

    if (data.Availability && Array.isArray(data.Availability)) {
      return {
        availability: data.Availability.map(slot => this.normalizeAvailabilityData(slot)),
        totalCount: data.TotalCount || data.Availability.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        availability: data.map(slot => this.normalizeAvailabilityData(slot)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    }
    return {
      availability: [this.normalizeAvailabilityData(data)],
      totalCount: 1,
      hasMore: false,
      nextStartKey: null
    };
  },

  normalizeAvailabilityData(availability) {
    return {
      startTime: availability.StartTime || availability.startTime,
      endTime: availability.EndTime || availability.endTime,
      providerId: availability.ProviderId || availability.providerId,
      resourceId: availability.ResourceId || availability.resourceId,
      serviceLocationId: availability.ServiceLocationId || availability.serviceLocationId,
      appointmentReasonId: availability.AppointmentReasonId || availability.appointmentReasonId
    };
  },

  normalizeGetPracticesResponse(result) {
    const data = this.unwrap(result);

    if (data.Practices && Array.isArray(data.Practices)) {
      return {
        practices: data.Practices.map(practice => this.normalizePracticeData(practice)),
        totalCount: data.TotalCount || data.Practices.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        practices: data.map(practice => this.normalizePracticeData(practice)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    }
    return {
      practices: [this.normalizePracticeData(data)],
      totalCount: 1,
      hasMore: false,
      nextStartKey: null
    };
  },

  normalizeGetProvidersResponse(result) {
    const data = this.unwrap(result);

    if (data.Providers && Array.isArray(data.Providers)) {
      return {
        providers: data.Providers.map(provider => this.normalizeProviderData(provider)),
        totalCount: data.TotalCount || data.Providers.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        providers: data.map(provider => this.normalizeProviderData(provider)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    }
    return {
      providers: [this.normalizeProviderData(data)],
      totalCount: 1,
      hasMore: false,
      nextStartKey: null
    };
  },

  normalizePracticeData(practice) {
    return {
      id: practice.ID || practice.id || practice.PracticeId || practice.practiceId,
      name: practice.PracticeName || practice.name,
      taxId: practice.TaxID || practice.taxId,
      npi: practice.NPI || practice.npi,
      address: {
        line1: practice.PracticeAddressLine1 || practice.addressLine1,
        line2: practice.PracticeAddressLine2 || practice.addressLine2,
        city: practice.PracticeCity || practice.city,
        state: practice.PracticeState || practice.state,
        zipCode: practice.PracticeZipCode || practice.zipCode,
        country: practice.PracticeCountry || practice.country
      },
      phone: practice.Phone || practice.phone,
      fax: practice.Fax || practice.fax,
      email: practice.Email || practice.email,
      active: practice.Active || practice.active,
      createdDate: practice.CreatedDate || practice.createdDate,
      lastModifiedDate: practice.LastModifiedDate || practice.lastModifiedDate
    };
  },

  normalizeProviderData(provider) {
    return {
      id: provider.ID || provider.id,
      fullName: provider.FullName || provider.fullName,
      firstName: provider.FirstName || provider.firstName,
      lastName: provider.LastName || provider.lastName,
      middleName: provider.MiddleName || provider.middleName,
      prefix: provider.Prefix || provider.prefix,
      suffix: provider.Suffix || provider.suffix,
      degree: provider.Degree || provider.degree,
      specialtyName: provider.SpecialtyName || provider.specialtyName,
      nationalProviderIdentifier: provider.NationalProviderIdentifier || provider.nationalProviderIdentifier,
      type: provider.Type || provider.type,
      billingType: provider.BillingType || provider.billingType,
      emailAddress: provider.EmailAddress || provider.emailAddress,
      addressLine1: provider.AddressLine1 || provider.addressLine1,
      addressLine2: provider.AddressLine2 || provider.addressLine2,
      city: provider.City || provider.city,
      state: provider.State || provider.state,
      zipCode: provider.ZipCode || provider.zipCode,
      country: provider.Country || provider.country,
      practiceId: provider.PracticeID || provider.practiceId,
      practiceName: provider.PracticeName || provider.practiceName,
      departmentName: provider.DepartmentName || provider.departmentName,
      notes: provider.Notes || provider.notes,
      encounterFormName: provider.EncounterFormName || provider.encounterFormName,
      isActive: provider.Active || provider.active || provider.IsActive || provider.isActive,
      title: provider.Title || provider.title,
      phone: provider.WorkPhone || provider.workPhone || provider.Phone || provider.phone,
      performanceReport: {
        active: provider.ProviderPerformanceReportActive || provider.performanceReportActive,
        ccEmailRecipients: provider.ProviderPerformanceReportCCEmailRecipients || provider.performanceReportCCEmailRecipients,
        delay: provider.ProviderPerformanceReportDelay || provider.performanceReportDelay,
        frequency: provider.ProviderPerformanceReportFequency || provider.performanceReportFrequency,
        scope: provider.ProviderPerformanceReportScope || provider.performanceReportScope
      },
      createdDate: provider.CreatedDate || provider.createdDate,
      lastModifiedDate: provider.LastModifiedDate || provider.lastModifiedDate
    };
  }
};
