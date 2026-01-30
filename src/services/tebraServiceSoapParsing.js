// backend/src/services/tebraServiceSoapParsing.js

module.exports = {
  parseRawSOAPResponse(xmlResponse, methodName) {
    try {
      const resultMatch = xmlResponse.match(new RegExp(`<${methodName}Result[^>]*>(.*?)</${methodName}Result>`, 's'));
      if (resultMatch) {
        const resultXml = resultMatch[1];

        if (methodName === 'CreatePatient') {
          const patient = {};
          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                patient[fieldName] = fieldValue;
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Patient: patient,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'CreateAppointment') {
          const appointment = {};
          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                appointment[fieldName] = fieldValue;
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Appointment: appointment,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'DeleteAppointment') {
          const successMatch = resultXml.match(/<Success>([^<]+)<\/Success>/i);
          const success = successMatch ? successMatch[1].toLowerCase() === 'true' : false;

          const idMatch = resultXml.match(/<AppointmentId>([^<]+)<\/AppointmentId>/i) || resultXml.match(/<AppointmentID>([^<]+)<\/AppointmentID>/i) || [];
          const appointmentId = idMatch[1] || null;

          return {
            [`${methodName}Result`]: {
              Success: success,
              AppointmentId: appointmentId,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'UpdateAppointment') {
          const appointment = {};
          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                appointment[fieldName] = fieldValue;
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Appointment: appointment,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'GetPractices') {
          const practices = [];
          const practiceMatches = resultXml.match(/<PracticeData[^>]*>(.*?)<\/PracticeData>/gs);

          if (practiceMatches) {
            for (const practiceXml of practiceMatches) {
              const practice = {};

              const fieldMatches = practiceXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
              if (fieldMatches) {
                for (const fieldMatch of fieldMatches) {
                  const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
                  if (fieldNameMatch) {
                    const fieldName = fieldNameMatch[1];
                    const fieldValue = fieldNameMatch[2];
                    practice[fieldName] = fieldValue;
                  }
                }
              }

              if (Object.keys(practice).length > 0) {
                practices.push(practice);
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Practices: practices,
              TotalCount: practices.length,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'GetAppointmentReasons') {
          const reasons = [];
          const blockRegex = /<(?:[a-zA-Z0-9_]+:)?(AppointmentReasonData|AppointmentReason)[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?\1>/gi;
          let blockMatch;
          const blocks = [];
          while ((blockMatch = blockRegex.exec(resultXml)) !== null) {
            blocks.push(blockMatch[2]);
          }
          if (blocks.length === 0) {
            let m;
            const re1 = /<AppointmentReasonData[^>]*>([\s\S]*?)<\/AppointmentReasonData>/gi;
            while ((m = re1.exec(resultXml)) !== null) { if (m[1]) blocks.push(m[1]); }
            if (blocks.length === 0) {
              const re2 = /<AppointmentReason[^>]*>([\s\S]*?)<\/AppointmentReason>/gi;
              while ((m = re2.exec(resultXml)) !== null) { if (m[1]) blocks.push(m[1]); }
            }
          }
          for (const reasonXml of blocks) {
            const reason = {};
            const fieldMatches = reasonXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
            if (fieldMatches) {
              for (const fieldMatch of fieldMatches) {
                const m = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
                if (m) {
                  const key = m[1].includes(':') ? m[1].split(':').pop() : m[1];
                  reason[key] = m[2];
                }
              }
            }
            if (reason.ID == null && reason.AppointmentReasonID == null && reason.AppointmentReasonId == null && reason.Id == null) {
              const idRegex = /<(?:[^:>]+:)?(AppointmentReasonID|AppointmentReasonId|ID|Id)>([^<]+)</gi;
              let idM;
              while ((idM = idRegex.exec(reasonXml)) !== null) {
                const v = idM[2]?.trim();
                if (v && !/^\s*$/.test(v)) {
                  reason[idM[1]] = v;
                  break;
                }
              }
            }
            if (Object.keys(reason).length > 0) reasons.push(reason);
          }
          const totalMatch = resultXml.match(/<TotalCount>([^<]+)<\/TotalCount>/i);
          const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : reasons.length;
          return {
            [`${methodName}Result`]: {
              AppointmentReasons: reasons,
              TotalCount: totalCount,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'GetProviders') {
          const providers = [];
          const providerMatches = resultXml.match(/<ProviderData[^>]*>(.*?)<\/ProviderData>/gs);

          if (providerMatches) {
            for (const providerXml of providerMatches) {
              const provider = {};

              const fieldMatches = providerXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
              if (fieldMatches) {
                for (const fieldMatch of fieldMatches) {
                  const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
                  if (fieldNameMatch) {
                    const fieldName = fieldNameMatch[1];
                    const fieldValue = fieldNameMatch[2];
                    provider[fieldName] = fieldValue;
                  }
                }
              }

              if (Object.keys(provider).length > 0) {
                providers.push(provider);
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Providers: providers,
              TotalCount: providers.length,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'GetPatients') {
          const patients = [];
          const patientMatches = resultXml.match(/<PatientData[^>]*>(.*?)<\/PatientData>/gs);

          if (patientMatches) {
            for (const patientXml of patientMatches) {
              const patient = {};

              const fieldMatches = patientXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
              if (fieldMatches) {
                for (const fieldMatch of fieldMatches) {
                  const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
                  if (fieldNameMatch) {
                    const fieldName = fieldNameMatch[1];
                    const fieldValue = fieldNameMatch[2];
                    patient[fieldName] = fieldValue;
                  }
                }
              }

              if (Object.keys(patient).length > 0) {
                patients.push(patient);
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Patients: patients,
              TotalCount: patients.length,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'GetAppointments') {
          const appointments = [];
          const appointmentMatches = resultXml.match(/<AppointmentData>(.*?)<\/AppointmentData>/gs);

          if (appointmentMatches) {
            for (const appointmentXml of appointmentMatches) {
              const appointment = {};

              const fieldMatches = appointmentXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
              if (fieldMatches) {
                for (const fieldMatch of fieldMatches) {
                  const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
                  if (fieldNameMatch) {
                    const fieldName = fieldNameMatch[1];
                    const fieldValue = fieldNameMatch[2];
                    appointment[fieldName] = fieldValue;
                  }
                }
              }

              if (Object.keys(appointment).length > 0) {
                appointments.push(appointment);
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Appointments: appointments,
              TotalCount: appointments.length,
              rawXml: resultXml
            }
          };
        }

        if (methodName === 'GetAppointment') {
          const appointment = {};

          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                appointment[fieldName] = fieldValue;
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Appointment: appointment,
              rawXml: resultXml
            }
          };
        }

        return {
          [`${methodName}Result`]: {
            rawXml: resultXml
          }
        };
      }

      console.warn(`⚠️ [TEBRA] No result found in XML response for ${methodName}`);
      return {
        [`${methodName}Result`]: {
          Patients: methodName === 'GetPatients' ? [] : undefined,
          Appointments: methodName === 'GetAppointments' ? [] : undefined,
          Appointment: methodName === 'GetAppointment' ? {} : undefined,
          TotalCount: 0
        }
      };
    } catch (error) {
      console.error(`❌ Error parsing raw SOAP response for ${methodName}:`, error.message);
      return { rawResponse: xmlResponse, parseError: error.message };
    }
  },

  parsePatientsFromXML(resultXml) {
    const patients = [];
    const patientMatches = resultXml.match(/<Patient[^>]*>(.*?)<\/Patient>/gs);

    if (patientMatches) {
      for (const patientXml of patientMatches) {
        const patient = {};

        const fieldMatches = patientXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
        if (fieldMatches) {
          for (const fieldMatch of fieldMatches) {
            const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
            if (fieldNameMatch) {
              const fieldName = fieldNameMatch[1];
              const fieldValue = fieldNameMatch[2];
              patient[fieldName] = fieldValue;
            }
          }
        }

        if (Object.keys(patient).length > 0) {
          patients.push(patient);
        }
      }
    }

    return patients;
  },

  generateSOAPEnvelope(methodName, args = {}) {
    const authHeader = this.buildRequestHeader();
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.kareo.com/api/schemas/">
   <soapenv:Header/>
   <soapenv:Body>
      <sch:${methodName}>
         <sch:request>
            <sch:RequestHeader>
               <sch:CustomerKey>${authHeader.CustomerKey}</sch:CustomerKey>
               <sch:Password>${authHeader.Password}</sch:Password>
               <sch:User>${authHeader.User}</sch:User>
            </sch:RequestHeader>
            ${Object.keys(args).map(key => {
              if (typeof args[key] === 'object' && args[key] !== null) {
                return `<sch:${key}>
               ${Object.keys(args[key]).map(subKey =>
                 `<sch:${subKey}>${args[key][subKey]}</sch:${subKey}>`
               ).join('\n               ')}
            </sch:${key}>`;
              }
              return `<sch:${key}>${args[key]}</sch:${key}>`;
            }).join('\n            ')}
         </sch:request>
      </sch:${methodName}>
   </soapenv:Body>
</soapenv:Envelope>`;

    return soapEnvelope;
  }
};
