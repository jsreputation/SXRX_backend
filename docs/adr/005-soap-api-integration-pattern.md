# ADR-005: SOAP API Integration Pattern

## Status
Accepted

## Context
The SXRX platform integrates with Tebra EHR via SOAP 2.1 API, which has:
- Strict field ordering requirements in XML
- Complex nested data structures
- XML-based request/response format
- Rate limiting and connection issues
- Two integration modes: SOAP library vs. raw HTTP requests

## Decision
We implemented a dual-mode SOAP integration with modular architecture:

### Architecture
1. **Dual Mode Support**:
   - **SOAP Library Mode**: Uses `soap` npm library (default, easier to use)
   - **Raw SOAP Mode**: Direct HTTP requests with manually constructed XML (more reliable for complex operations)

2. **Modular Service Structure**:
   - `soapClient.js`: Core SOAP client initialization and connection management
   - `soapUtils.js`: XML utilities (escaping, parsing, error handling)
   - `soapXmlGenerators.js`: SOAP XML generation for all methods with proper field ordering
   - `patientMethods.js`: Patient-related operations (extracted from monolithic service)
   - `index.js`: Main TebraService class integrating all modules

3. **Field Ordering Compliance**:
   - `generateCreateAppointmentSOAPXML()` enforces strict field order (PracticeId before StartTime, etc.)
   - Field order validated and logged for debugging
   - Required fields checked before XML generation

4. **Error Handling**:
   - SOAP fault parsing and extraction
   - Detailed error logging with request/response data
   - Graceful fallback between SOAP library and raw SOAP modes

### Key Features
- **XML Escaping**: All user input escaped to prevent XML injection
- **Response Parsing**: Handles multiple response formats from Tebra API
- **Connection Management**: Automatic reconnection and connection testing
- **Rate Limiting**: Configurable delays between API calls

## Consequences

### Positive
- Modular structure makes code maintainable and testable
- Raw SOAP mode provides more control and reliability
- Field ordering compliance prevents API errors
- Comprehensive error handling improves debugging
- Can switch between modes based on operation type

### Negative
- More complex than simple REST API integration
- XML generation requires careful attention to field order
- Two code paths to maintain (SOAP library vs. raw)
- Large service file (being incrementally modularized)

### Implementation Notes
- Raw SOAP mode is enabled by default (`TEBRA_USE_RAW_SOAP=true`)
- Field ordering is critical - Tebra API rejects requests with incorrect order
- XML escaping prevents injection attacks
- Response parsing handles various Tebra API response formats

## Alternatives Considered
1. **SOAP library only**: Rejected due to reliability issues with complex operations
2. **Raw SOAP only**: Rejected due to complexity for simple operations
3. **GraphQL wrapper**: Not applicable (Tebra only provides SOAP API)

## References
- Tebra SOAP API 2.1 Technical Guide
- SOAP Specification: https://www.w3.org/TR/soap/
- XML Security: OWASP XML Security Cheat Sheet
