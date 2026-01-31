// backend/src/controllers/shopifyStorefrontAuthController.js
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { normalizeShopifyDomain } = require('../utils/shopifyDomain');
const { getFormattedLocation } = require('../utils/locationUtils');
const storefrontQueries = require('./shopifyStorefrontAuthQueries');

class ShopifyStorefrontAuthController {
  constructor() {
    // Support both new and legacy env var names to reduce setup friction
    this.storeDomain = normalizeShopifyDomain(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE);
    this.storefrontAccessToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
    this.apiVersion = process.env.SHOPIFY_API_VERSION || '2025-07';
    this.graphqlUrl = this.storeDomain ? `https://${this.storeDomain}/api/${this.apiVersion}/graphql.json` : null;
    
    // Validate configuration (warn once on startup)
    if (!this.storeDomain || !this.storefrontAccessToken) {
      console.warn('⚠️ Shopify Storefront configuration not fully set. Some auth endpoints may not function until configured.');
      console.warn('   SHOPIFY_STORE_DOMAIN or SHOPIFY_STORE:', this.storeDomain ? '✅ Set' : '❌ Missing');
      console.warn('   SHOPIFY_STOREFRONT_ACCESS_TOKEN or SHOPIFY_ACCESS_TOKEN:', this.storefrontAccessToken ? '✅ Set' : '❌ Missing');
    }
  }

  get queries() {
    return storefrontQueries;
  }

  async makeGraphQLRequest(query, variables = {}) {
    try {
      const response = await axios.post(this.graphqlUrl, {
        query,
        variables
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': this.storefrontAccessToken,
        },
        timeout: 10000,
        validateStatus: () => true,
      });

      if (!response) {
        const err = new Error('No response from Shopify Storefront');
        err.code = 'NO_RESPONSE';
        throw err;
      }

      // Handle non-2xx statuses from Shopify explicitly
      if (response.status < 200 || response.status >= 300) {
        const shopifyMessage = response.data?.errors?.[0]?.message || response.statusText || 'Storefront request failed';
        const e = new Error(shopifyMessage);
        e.status = response.status;
        e.details = response.data;
        throw e;
      }

      if (response.data?.errors?.length) {
        const shopifyMessage = response.data.errors[0]?.message || 'Storefront error';
        const e = new Error(shopifyMessage);
        e.status = 400;
        e.details = response.data.errors;
        throw e;
      }

      return response.data.data;
    } catch (error) {
      // Normalize axios/network error with clearer messages and avoid leaking 502 upstream
      const isAxios = !!(error?.isAxiosError || error?.response || error?.request);
      if (isAxios) {
        // Prefer Shopify response status; otherwise map network failures to 500 with descriptive message
        const upstreamStatus = error?.response?.status;
        let status = Number.isInteger(upstreamStatus) ? upstreamStatus : 500;

        // Build a helpful message
        let message = error?.response?.data?.errors?.[0]?.message
          || error?.response?.statusText
          || error?.message
          || 'Shopify Storefront request failed';

        // Enhance message for common network failures (no response)
        if (!error?.response) {
          const code = error?.code || (error?.message || '').split(' ').find(Boolean) || 'NETWORK_ERROR';
          const friendly = {
            ENOTFOUND: 'Unable to resolve Shopify domain. Check SHOPIFY_STORE_DOMAIN.',
            ECONNREFUSED: 'Connection to Shopify was refused. Verify network and domain.',
            ETIMEDOUT: 'Connection to Shopify timed out. Please try again.',
            ECONNABORTED: 'Shopify request aborted due to timeout. Please try again.',
            ERR_INVALID_URL: 'Invalid Shopify GraphQL URL. Check SHOPIFY_STORE_DOMAIN and SHOPIFY_API_VERSION.',
          };
          message = friendly[code] || 'Shopify Storefront is not reachable. Check configuration and network.';
          status = 500;
        }

        const e = new Error(message);
        e.status = status;
        e.details = error?.response?.data || { code: error?.code };
        throw e;
      }
      throw error;
    }
  }

  // Customer login
  login = async (req, res) => {
    try {
      const { clientLocation } = req;
      const { email, password } = req.body;

      console.log(`🔐 [SHOPIFY LOGIN] Login attempt from ${getFormattedLocation(clientLocation)}`);

      // Check if Shopify is configured
      if (!this.storeDomain || !this.storefrontAccessToken) {
        return res.status(500).json({
          success: false,
          message: 'Shopify configuration is missing. Please check environment variables.',
          location: clientLocation
        });
      }

      // Enhanced input validation
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required',
          location: clientLocation
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid email address',
          location: clientLocation
        });
      }

      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long',
          location: clientLocation
        });
      }

      console.log('🔍 Login attempt for email:', email);

      const queries = this.queries;
      const variables = {
        input: {
          email,
          password,
        },
      };

      const data = await this.makeGraphQLRequest(queries.CUSTOMER_ACCESS_TOKEN_CREATE, variables);
      
      if (data.customerAccessTokenCreate.customerUserErrors.length > 0) {
        const error = data.customerAccessTokenCreate.customerUserErrors[0];
        
        // Provide more specific error messages
        if (error.message === "Unidentified customer") {
          return res.status(401).json({
            success: false,
            message: "No account found with this email address. Please register first or check your email.",
            location: clientLocation
          });
        } else if (error.message.includes("password") || error.message.includes("Password")) {
          return res.status(401).json({
            success: false,
            message: "Incorrect password. Please try again.",
            location: clientLocation
          });
        } else if (error.message.includes("email") || error.message.includes("Email")) {
          return res.status(400).json({
            success: false,
            message: "Invalid email address format.",
            location: clientLocation
          });
        } else {
          return res.status(400).json({
            success: false,
            message: error.message,
            location: clientLocation
          });
        }
      }

      const accessToken = data.customerAccessTokenCreate.customerAccessToken.accessToken;
      const expiresAt = data.customerAccessTokenCreate.customerAccessToken.expiresAt;

      // Get customer data
      const customer = await this.getCustomer(accessToken);

      // Check JWT_SECRET before generating token
      if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET is not configured');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error - JWT secret missing'
        });
      }

      // Generate JWT token for our backend
      const tokenPayload = {
        sub: customer.id,
        customerId: customer.id,
        email: customer.email,
        role: 'customer',
        shopifyAccessToken: accessToken,
        shopifyExpiresAt: expiresAt,
      };

      console.log('🔍 Generating JWT token with payload:', {
        customerId: tokenPayload.customerId,
        email: tokenPayload.email,
        role: tokenPayload.role,
        hasShopifyToken: !!tokenPayload.shopifyAccessToken
      });

      const jwtToken = jwt.sign(
        tokenPayload,
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Set HttpOnly cookie for JWT (migration-friendly; frontend may still read legacy cookie)
      try {
        const isProd = process.env.NODE_ENV === 'production';
        const cookieOpts = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };
        if (expiresAt) cookieOpts.expires = new Date(expiresAt);
        res.cookie('sxrx_jwt', jwtToken, cookieOpts);
      } catch (e) {
        console.warn('Warning: failed to set HttpOnly cookie sxrx_jwt:', e?.message || e);
      }

      // Stop logging JWT fragments; just log success
      console.log(`✅ [SHOPIFY LOGIN] Successful login for ${customer.email}`);

      // Generate refresh token for persistent sessions
      let refreshToken = null;
      try {
        const authService = require('../services/authService');
        const deviceInfo = req.headers['user-agent'] || 'unknown';
        refreshToken = await authService.storeRefreshToken({
          userId: String(customer.id),
          userType: 'shopify_customer',
          deviceInfo,
          ipAddress: req.ip || req.connection?.remoteAddress
        });
        console.log(`✅ [SHOPIFY LOGIN] Refresh token generated for ${customer.email}`);
      } catch (refreshErr) {
        console.warn('[SHOPIFY LOGIN] Failed to generate refresh token (non-critical):', refreshErr?.message || refreshErr);
      }

      // Ensure mapping with Tebra patient id using PostgreSQL mapping table
      let tebraPatientId = null;
      try {
        const mapService = require('../services/customerPatientMapService');
        const autoSyncTebra = process.env.AUTO_SYNC_TEBRA !== 'false';
        
        // Check for existing mapping
        const existing = await mapService.getByShopifyIdOrEmail(customer.id, customer.email);
        
        // Only use existing mapping if AUTO_SYNC_TEBRA is enabled
        // If AUTO_SYNC_TEBRA=false, we want to force registration, so ignore existing mappings
        if (autoSyncTebra && existing && existing.tebra_patient_id) {
          tebraPatientId = existing.tebra_patient_id;
          console.log(`   ✅ [LOGIN] Using existing mapping: ${tebraPatientId}`);
        } else {
          // If AUTO_SYNC_TEBRA=false, clear any existing mapping to force fresh registration
          if (existing && existing.tebra_patient_id && !autoSyncTebra) {
            console.log(`   ⚠️ [LOGIN] Ignoring existing mapping (AUTO_SYNC_TEBRA=false) - forcing registration`);
            try {
              await mapService.deleteByShopifyIdOrEmail(customer.id, customer.email);
              console.log(`   🗑️ [LOGIN] Cleared existing mapping (AUTO_SYNC_TEBRA=false)`);
            } catch (clearError) {
              console.warn('   ⚠️ [LOGIN] Failed to clear mapping:', clearError?.message);
            }
          }
          
          // Only create new patient if AUTO_SYNC_TEBRA is enabled
          if (autoSyncTebra) {
            const tebraService = require('../services/tebraService');
            const patientPayload = {
              email: customer.email,
              firstName: customer.firstName,
              lastName: customer.lastName,
              phone: customer.phone,
              state: customer?.defaultAddress?.province || undefined,
            };
            const tebraResp = await tebraService.createPatient(patientPayload);
            if (tebraResp && tebraResp.id) {
              tebraPatientId = tebraResp.id;
              console.log(`   ✅ [LOGIN] Created new patient: ${tebraPatientId}`);
            }
          } else {
            console.log(`   📝 [LOGIN] AUTO_SYNC_TEBRA=false - no patient created, will require registration`);
          }
          
          // Update mapping (will be null if AUTO_SYNC_TEBRA=false)
          await mapService.upsert(customer.id, customer.email, tebraPatientId);
        }
      } catch (e) {
        console.warn('Tebra ensure mapping on login failed:', e?.message || e);
      }

      res.json({
        success: true,
        message: 'Login successful',
        token: jwtToken,
        refreshToken: refreshToken,
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          role: 'customer'
        },
        tebraPatientId: tebraPatientId || null,
        shopifyAccessToken: accessToken,
        expiresAt,
        location: clientLocation
      });

    } catch (error) {
      const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
      const safeMessage = error?.message || 'Login failed. Please try again.';
      console.error(`Shopify login error (${status}):`, safeMessage);
      res.status(status).json({
        success: false,
        message: safeMessage,
        location: req.clientLocation
      });
    }
  };

  // Create backend session for Shopify logged-in customers (new customer accounts)
  createSession = async (req, res) => {
    try {
      const { clientLocation } = req;
      const { customerId, email } = req.body || {};

      if (!customerId || !email) {
        return res.status(400).json({
          success: false,
          message: 'customerId and email are required',
          location: clientLocation
        });
      }

      if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET is not configured');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error - JWT secret missing'
        });
      }

      if (!process.env.SHOPIFY_ACCESS_TOKEN || !this.storeDomain) {
        return res.status(500).json({
          success: false,
          message: 'Shopify Admin API configuration is missing',
          location: clientLocation
        });
      }

      const shopifyUserService = require('../services/shopifyUserService');
      const customer = await shopifyUserService.getCustomer(customerId);
      if (!customer) {
        return res.status(401).json({
          success: false,
          message: 'Customer not found',
          location: clientLocation
        });
      }

      const emailMatch = (customer.email || '').toLowerCase() === String(email).toLowerCase();
      if (!emailMatch) {
        return res.status(403).json({
          success: false,
          message: 'Customer email does not match',
          location: clientLocation
        });
      }

      const tokenPayload = {
        sub: customer.id,
        customerId: customer.id,
        email: customer.email,
        role: 'customer'
      };

      const jwtToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' });

      // Set HttpOnly cookie for JWT
      try {
        const isProd = process.env.NODE_ENV === 'production';
        const cookieOpts = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };
        res.cookie('sxrx_jwt', jwtToken, cookieOpts);
      } catch (e) {
        console.warn('Warning: failed to set HttpOnly cookie sxrx_jwt:', e?.message || e);
      }

      res.json({
        success: true,
        token: jwtToken,
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.first_name,
          lastName: customer.last_name,
          phone: customer.phone
        },
        location: clientLocation
      });
    } catch (error) {
      console.error('Create session error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create session',
        error: error.message,
        location: req.clientLocation
      });
    }
  };

  // Customer registration
  register = async (req, res) => {
    try {
      const { clientLocation } = req;
      const { email, password, firstName, lastName, phone, state, acceptsMarketing } = req.body;

      console.log(`📝 [SHOPIFY REGISTER] Registration attempt from ${getFormattedLocation(clientLocation)}`);

      // Validate required fields - first name, last name, and email are mandatory; phone is optional
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({
          success: false,
          message: 'Email, password, first name, and last name are required',
          location: clientLocation
        });
      }

      // Phone: optional; when provided, validate format
      const phoneTrimmed = (phone && typeof phone === 'string') ? phone.trim() : '';
      if (phoneTrimmed.length > 0) {
        if (phoneTrimmed.length < 10 || phoneTrimmed.length > 20) {
          return res.status(400).json({
            success: false,
            message: 'Phone number must be between 10 and 20 characters',
            location: clientLocation
          });
        }
      }

      // State is required for Tebra patient creation
      const patientState = state || clientLocation?.state || 'CA';
      if (!patientState) {
        return res.status(400).json({
          success: false,
          message: 'State is required for patient registration',
          location: clientLocation
        });
      }

      const queries = this.queries;
      const input = {
        email,
        password,
        firstName,
        lastName,
        acceptsMarketing: acceptsMarketing || false,
      };
      if (phoneTrimmed.length > 0) {
        input.phone = phoneTrimmed;
      }
      const variables = { input };

      const data = await this.makeGraphQLRequest(queries.CUSTOMER_CREATE, variables);
      
      if (data.customerCreate.customerUserErrors.length > 0) {
        const error = data.customerCreate.customerUserErrors[0];
        
        // Provide more specific error messages for common registration issues
        if (error.message.includes("Email has already been taken") || error.message.includes("already exists")) {
          return res.status(400).json({
            success: false,
            message: "An account with this email address already exists. Please try logging in instead.",
            location: clientLocation
          });
        } else if (error.message.includes("Password") && error.message.includes("too short")) {
          return res.status(400).json({
            success: false,
            message: "Password must be at least 5 characters long.",
            location: clientLocation
          });
        } else if (error.message.includes("Email") && error.message.includes("invalid")) {
          return res.status(400).json({
            success: false,
            message: "Please enter a valid email address.",
            location: clientLocation
          });
        } else if (error.field === "email") {
          return res.status(400).json({
            success: false,
            message: "Invalid email address format.",
            location: clientLocation
          });
        } else if (error.field === "password") {
          return res.status(400).json({
            success: false,
            message: "Password does not meet requirements.",
            location: clientLocation
          });
        } else {
          return res.status(400).json({
            success: false,
            message: error.message || "Registration failed. Please try again.",
            location: clientLocation
          });
        }
      }

      if (!data.customerCreate.customer) {
        return res.status(500).json({
          success: false,
          message: "Registration failed. Please try again.",
          location: clientLocation
        });
      }

      const customer = data.customerCreate.customer;

      console.log(`✅ [SHOPIFY REGISTER] Successful registration for ${customer.email}`);

      // Check if guest data exists (questionnaire completions, patient records)
      let existingPatientId = null;
      try {
        const customerPatientMapService = require('../services/customerPatientMapService');
        const existingMapping = await customerPatientMapService.getByShopifyIdOrEmail(null, customer.email);
        if (existingMapping && existingMapping.tebra_patient_id) {
          existingPatientId = existingMapping.tebra_patient_id;
          console.log(`✅ [STOREFRONT REGISTER] Found existing patient record for guest: ${existingPatientId}`);
        }
      } catch (mappingErr) {
        console.warn('[STOREFRONT REGISTER] Failed to check for existing guest data:', mappingErr?.message || mappingErr);
      }

      // Attempt to create/link a Tebra patient chart for this customer (best-effort)
      let tebraPatientId = null;
      try {
        // Build minimal demographics for Tebra from Shopify data
        const tebraService = require('../services/tebraService');
        const customerPatientMapService = require('../services/customerPatientMapService');
        
        if (existingPatientId) {
          // Use existing patient
          tebraPatientId = existingPatientId;
          console.log(`✅ [STOREFRONT REGISTER] Using existing Tebra patient: ${tebraPatientId}`);
        } else {
          // Create new patient in Tebra using registration data
          const patientPayload = {
            email: email, // Use email from request (customer.email might not be set yet)
            firstName: firstName, // Use firstName from request
            lastName: lastName, // Use lastName from request
            phone: phone || customer.phone || '',
            state: patientState, // Use state from request or location
          };
          
          console.log(`📝 [STOREFRONT REGISTER] Creating Tebra patient with:`, {
            email: patientPayload.email,
            firstName: patientPayload.firstName,
            lastName: patientPayload.lastName,
            state: patientPayload.state
          });
          
          const tebraResp = await tebraService.createPatient(patientPayload);
          if (tebraResp && tebraResp.id) {
            tebraPatientId = tebraResp.id;
            console.log(`✅ [STOREFRONT REGISTER] Created new Tebra patient: ${tebraPatientId}`);
          } else {
            console.warn(`⚠️ [STOREFRONT REGISTER] Tebra patient creation returned no ID:`, tebraResp);
          }
        }
        
        // Store/update customer-patient mapping
        if (tebraPatientId) {
          await customerPatientMapService.upsert(customer.id, customer.email, tebraPatientId);
        }
      } catch (e) {
        console.warn('[STOREFRONT REGISTER] Tebra patient creation/update failed:', e?.message || e);
      }

      // Link guest data to customer account (questionnaire completions, etc.)
      try {
        const guestAccountLinkingService = require('../services/guestAccountLinkingService');
        const linkingResults = await guestAccountLinkingService.linkGuestToCustomer(customer.email, customer.id);
        console.log(`✅ [STOREFRONT REGISTER] Linked guest data: ${linkingResults.questionnaireCompletionsLinked} completions, ${linkingResults.patientMappingsUpdated} mappings`);
        if (linkingResults.errors.length > 0) {
          console.warn('[STOREFRONT REGISTER] Guest linking had errors:', linkingResults.errors);
        }
      } catch (linkingErr) {
        console.warn('[STOREFRONT REGISTER] Failed to link guest data (non-critical):', linkingErr?.message || linkingErr);
        // Don't fail registration if linking fails
      }

      // Create and send email verification token
      let verificationSent = false;
      try {
        const emailVerificationService = require('../services/emailVerificationService');
        const { token } = await emailVerificationService.createVerificationToken(customer.email, customer.id);
        await emailVerificationService.sendVerificationEmail(customer.email, token, firstName);
        verificationSent = true;
        console.log(`✅ [STOREFRONT REGISTER] Verification email sent to ${customer.email}`);
      } catch (verificationErr) {
        console.warn('[STOREFRONT REGISTER] Failed to send verification email (non-critical):', verificationErr?.message || verificationErr);
        // Don't fail registration if verification email fails
      }

      // Get customer access token for immediate login
      // Note: User should verify email before full access, but we allow login
      let customerAccessToken = null;
      try {
        const loginVariables = {
          input: {
            email,
            password
          }
        };
        const loginData = await this.makeGraphQLRequest(queries.CUSTOMER_ACCESS_TOKEN_CREATE, loginVariables);
        if (loginData.customerAccessTokenCreate.customerAccessToken) {
          customerAccessToken = loginData.customerAccessTokenCreate.customerAccessToken.accessToken;
          console.log(`✅ [STOREFRONT REGISTER] Generated access token for immediate login`);
        }
      } catch (tokenErr) {
        console.warn('[STOREFRONT REGISTER] Failed to generate access token (non-critical):', tokenErr?.message || tokenErr);
      }

      // Generate refresh token if customerAccessToken is available
      let refreshToken = null;
      if (customerAccessToken && customer.id) {
        try {
          const authService = require('../services/authService');
          const deviceInfo = req.headers['user-agent'] || 'unknown';
          refreshToken = await authService.storeRefreshToken({
            userId: String(customer.id),
            userType: 'shopify_customer',
            deviceInfo,
            ipAddress: req.ip || req.connection?.remoteAddress
          });
        } catch (refreshErr) {
          console.warn('[STOREFRONT REGISTER] Failed to generate refresh token (non-critical):', refreshErr?.message || refreshErr);
        }
      }

      res.status(201).json({
        success: true,
        message: verificationSent 
          ? 'Registration successful. Please check your email to verify your account.' 
          : 'Registration successful',
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          role: 'customer',
          emailVerified: false
        },
        customerAccessToken: customerAccessToken,
        refreshToken: refreshToken,
        tebraPatientId: tebraPatientId,
        emailVerificationSent: verificationSent,
        location: clientLocation
      });

    } catch (error) {
      console.error('Shopify registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Registration failed. Please try again.',
        error: error.message,
        location: req.clientLocation
      });
    }
  };

  // Get customer details
  async getCustomer(accessToken) {
    const queries = this.queries;
    const variables = {
      customerAccessToken: accessToken,
    };

    const data = await this.makeGraphQLRequest(queries.CUSTOMER_QUERY, variables);
    
    if (!data.customer) {
      const err = new Error('Customer not found or access token expired');
      err.status = 401;
      throw err;
    }

    // Transform addresses from edges format
    const addresses = data.customer.addresses.edges.map(edge => edge.node);

    return {
      ...data.customer,
      addresses,
    };
  }

  // Customer logout
  logout = async (req, res) => {
    try {
      const { clientLocation } = req;
      // Accept token from multiple sources for compatibility, and fallback to authenticated user
      const bodyToken = req.body?.shopifyAccessToken || req.body?.accessToken || req.body?.token;
      const tokenFromUser = req.user?.shopifyAccessToken;
      const shopifyAccessToken = bodyToken || tokenFromUser;

      console.log(`🚪 [SHOPIFY LOGOUT] Logout from ${getFormattedLocation(clientLocation)}`);

      if (shopifyAccessToken) {
        const queries = this.queries;
        const variables = {
          customerAccessToken: shopifyAccessToken,
        };

        try {
          await this.makeGraphQLRequest(queries.CUSTOMER_ACCESS_TOKEN_DELETE, variables);
        } catch (error) {
          console.error('Shopify logout error:', error);
          // Don't fail the logout if Shopify logout fails
        }
      }

      // Clear the JWT HttpOnly cookie (must match the options used when setting it)
      try {
        const isProd = process.env.NODE_ENV === 'production';
        res.clearCookie('sxrx_jwt', { 
          httpOnly: true, 
          secure: isProd, 
          sameSite: 'lax', 
          path: '/' 
        });
        console.log('✅ [SHOPIFY LOGOUT] JWT cookie cleared');
      } catch (e) {
        console.warn('⚠️ [SHOPIFY LOGOUT] Failed to clear JWT cookie:', e?.message || e);
        // Continue with logout even if cookie clearing fails
      }

      res.json({
        success: true,
        message: 'Logout successful',
        location: clientLocation
      });

    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Logout failed',
        error: error.message,
        location: req.clientLocation
      });
    }
  };

  // Get current customer
  getCurrentCustomer = async (req, res) => {
    try {
      const { clientLocation } = req;
      const { shopifyAccessToken } = req.user;

      console.log(`👤 [SHOPIFY GET CUSTOMER] Customer profile accessed from ${getFormattedLocation(clientLocation)}`);

      // Ensure Shopify configuration exists
      if (!this.storeDomain || !this.storefrontAccessToken) {
        return res.status(500).json({
          success: false,
          message: 'Shopify configuration is missing. Please check environment variables.',
          location: clientLocation
        });
      }

      let customer = null;
      if (shopifyAccessToken) {
        customer = await this.getCustomer(shopifyAccessToken);
      } else {
        const customerId = req.user?.shopifyCustomerId || req.user?.id || req.user?.customerId;
        if (!customerId) {
          return res.status(401).json({
            success: false,
            message: 'No Shopify access token found',
            location: clientLocation
          });
        }
        const shopifyUserService = require('../services/shopifyUserService');
        customer = await shopifyUserService.getCustomer(customerId);
        if (!customer) {
          return res.status(401).json({
            success: false,
            message: 'Customer not found',
            location: clientLocation
          });
        }
      }

      // Lookup Tebra mapping from PostgreSQL
      let tebraPatientId = null;
      try {
        const mapService = require('../services/customerPatientMapService');
        const existing = await mapService.getByShopifyIdOrEmail(customer.id, customer.email);
        const autoSyncTebra = process.env.AUTO_SYNC_TEBRA !== 'false';
        
        // Log for debugging (always log, not just in dev mode)
        console.log(`🔍 [GET /me] Customer ${customer.email}:`);
        console.log(`   AUTO_SYNC_TEBRA = ${autoSyncTebra}`);
        console.log(`   Mapping exists: ${!!existing}, tebra_patient_id: ${existing?.tebra_patient_id || 'null'}`);
        
        // Only use existing mapping if AUTO_SYNC_TEBRA is enabled
        // If AUTO_SYNC_TEBRA=false, we want to force registration, so ignore existing mappings
        if (autoSyncTebra && existing && existing.tebra_patient_id) {
          tebraPatientId = existing.tebra_patient_id;
          console.log(`   ✅ Using existing mapping: ${tebraPatientId}`);
        } else {
          if (existing && existing.tebra_patient_id && !autoSyncTebra) {
            console.log(`   ⚠️ Ignoring existing mapping (AUTO_SYNC_TEBRA=false) - forcing registration`);
            
            // When AUTO_SYNC_TEBRA=false, clear existing mappings to force registration
            // This works the same way in both dev and production
            try {
              await mapService.deleteByShopifyIdOrEmail(customer.id, customer.email);
              console.log(`   🗑️ Cleared existing mapping (AUTO_SYNC_TEBRA=false)`);
            } catch (clearError) {
              console.warn('   ⚠️ Failed to clear mapping:', clearError?.message);
            }
          }
          tebraPatientId = null;
          console.log(`   📝 tebraPatientId = null (will require registration)`);
        }
      } catch (e) {
        console.warn('Tebra map lookup in /me failed:', e?.message || e);
      }

      const normalizedCustomer = {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName || customer.first_name || null,
        lastName: customer.lastName || customer.last_name || null,
        phone: customer.phone || null,
        role: 'customer',
        addresses: customer.addresses || [],
        defaultAddress: customer.defaultAddress || customer.default_address || null
      };

      res.json({
        success: true,
        customer: normalizedCustomer,
        tebraPatientId: tebraPatientId || null, // Explicitly ensure null (not undefined)
        location: clientLocation
      });

    } catch (error) {
      console.error('Get customer error:', error);
      const status = Number.isInteger(error?.status) ? error.status : 500;
      // Map token issues to 401
      const isAuthError = status === 401 || status === 403 || /expired|invalid token|not found/i.test(error?.message || '');
      const finalStatus = isAuthError ? 401 : status;
      const message = isAuthError
        ? 'Your session has expired or is invalid. Please sign in again.'
        : (error?.message || 'Failed to get customer data');
      res.status(finalStatus).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error?.message : undefined,
        location: req.clientLocation
      });
    }
  };
}

module.exports = new ShopifyStorefrontAuthController();
