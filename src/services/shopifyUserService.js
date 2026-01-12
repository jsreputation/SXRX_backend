// backend/src/services/shopifyUserService.js
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Shopify configuration
const SHOPIFY_CONFIG = {
  shopDomain: process.env.SHOPIFY_STORE,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  apiVersion: '2024-01'
};

// Helper function to make authenticated Shopify API calls
async function makeShopifyRequest(endpoint, method = 'GET', data = null) {
  try {
    const url = `https://${SHOPIFY_CONFIG.shopDomain}/api/${SHOPIFY_CONFIG.apiVersion}/${endpoint}`;
    const config = {
      method,
      url,
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('Shopify API error:', error.response?.data || error.message);
    throw error;
  }
}

class ShopifyUserService {
  // Find customer by email
  async findCustomerByEmail(email) {
    try {
      const response = await makeShopifyRequest(`customers/search.json?query=email:${email}`);
      return response.customers && response.customers.length > 0 ? response.customers[0] : null;
    } catch (error) {
      console.error('Error finding customer:', error);
      return null;
    }
  }

  // Create new customer
  async createCustomer(customerData) {
    try {
      // Hash password for storage in metafields
      const hashedPassword = await bcrypt.hash(customerData.password, 10);
      
      const newCustomer = await makeShopifyRequest(
        'customers.json',
        'POST',
        {
          customer: {
            first_name: customerData.firstName,
            last_name: customerData.lastName,
            email: customerData.email,
            phone: customerData.phone || '',
            tags: 'sxrx-user',
            note: `State: ${customerData.state}, Role: ${customerData.role || 'patient'}`
          }
        }
      );

      // Store password and additional data in metafields
      await this.addCustomerMetafields(newCustomer.customer.id, {
        password: hashedPassword,
        state: customerData.state,
        role: customerData.role || 'patient',
        tebraPatientId: null,
        tebraSyncStatus: 'pending'
      });

      return newCustomer.customer;
    } catch (error) {
      console.error('Error creating customer:', error);
      throw error;
    }
  }

  // Update existing customer
  async updateCustomer(customerId, updateData) {
    try {
      const updatedCustomer = await makeShopifyRequest(
        `customers/${customerId}.json`,
        'PUT',
        {
          customer: {
            id: customerId,
            first_name: updateData.firstName,
            last_name: updateData.lastName,
            email: updateData.email,
            phone: updateData.phone,
            tags: updateData.tags || 'sxrx-user'
          }
        }
      );

      // Update metafields if provided
      if (updateData.metafields) {
        await this.updateCustomerMetafields(customerId, updateData.metafields);
      }

      return updatedCustomer.customer;
    } catch (error) {
      console.error('Error updating customer:', error);
      throw error;
    }
  }

  // Add metafields to customer
  async addCustomerMetafields(customerId, data) {
    try {
      const metafields = [];
      
      // Add password metafield
      if (data.password) {
        metafields.push({
          namespace: 'sxrx',
          key: 'password',
          value: data.password,
          type: 'single_line_text_field'
        });
      }

      // Add state metafield
      if (data.state) {
        metafields.push({
          namespace: 'sxrx',
          key: 'state',
          value: data.state,
          type: 'single_line_text_field'
        });
      }

      // Add role metafield
      if (data.role) {
        metafields.push({
          namespace: 'sxrx',
          key: 'role',
          value: data.role,
          type: 'single_line_text_field'
        });
      }

      // Add Tebra patient ID metafield
      if (data.tebraPatientId !== undefined) {
        metafields.push({
          namespace: 'sxrx',
          key: 'tebra_patient_id',
          value: data.tebraPatientId || '',
          type: 'single_line_text_field'
        });
      }

      // Add Tebra sync status metafield
      if (data.tebraSyncStatus) {
        metafields.push({
          namespace: 'sxrx',
          key: 'tebra_sync_status',
          value: data.tebraSyncStatus,
          type: 'single_line_text_field'
        });
      }

      // Create metafields
      for (const metafield of metafields) {
        await makeShopifyRequest(
          `customers/${customerId}/metafields.json`,
          'POST',
          { metafield }
        );
      }

      return true;
    } catch (error) {
      console.error('Error adding customer metafields:', error);
      throw error;
    }
  }

  // Update customer metafields
  async updateCustomerMetafields(customerId, data) {
    try {
      // Get existing metafields
      const existingMetafields = await makeShopifyRequest(`customers/${customerId}/metafields.json`);
      
      // Update or create metafields
      for (const [key, value] of Object.entries(data)) {
        const existingMetafield = existingMetafields.metafields?.find(
          mf => mf.namespace === 'sxrx' && mf.key === key
        );

        if (existingMetafield) {
          // Update existing metafield
          await makeShopifyRequest(
            `metafields/${existingMetafield.id}.json`,
            'PUT',
            {
              metafield: {
                id: existingMetafield.id,
                value: value
              }
            }
          );
        } else {
          // Create new metafield
          await makeShopifyRequest(
            `customers/${customerId}/metafields.json`,
            'POST',
            {
              metafield: {
                namespace: 'sxrx',
                key: key,
                value: value,
                type: 'single_line_text_field'
              }
            }
          );
        }
      }

      return true;
    } catch (error) {
      console.error('Error updating customer metafields:', error);
      throw error;
    }
  }

  // Get customer metafields
  async getCustomerMetafields(customerId) {
    try {
      const response = await makeShopifyRequest(`customers/${customerId}/metafields.json`);
      const metafields = {};
      
      if (response.metafields) {
        response.metafields.forEach(mf => {
          if (mf.namespace === 'sxrx') {
            metafields[mf.key] = mf.value;
          }
        });
      }
      
      return metafields;
    } catch (error) {
      console.error('Error getting customer metafields:', error);
      return {};
    }
  }

  // Verify customer password
  async verifyPassword(customer, password) {
    try {
      const metafields = await this.getCustomerMetafields(customer.id);
      const hashedPassword = metafields.password;
      
      if (!hashedPassword) {
        return false;
      }
      
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      console.error('Error verifying password:', error);
      return false;
    }
  }

  // Generate JWT token for customer
  generateToken(customer, metafields = {}) {
    const payload = {
      customerId: customer.id,
      email: customer.email,
      role: metafields.role || 'patient',
      state: metafields.state || 'CA'
    };

    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
  }

  // Get customer with metafields
  async getCustomerWithMetafields(customerId) {
    try {
      const customer = await makeShopifyRequest(`customers/${customerId}.json`);
      const metafields = await this.getCustomerMetafields(customerId);
      
      return {
        ...customer.customer,
        metafields
      };
    } catch (error) {
      console.error('Error getting customer with metafields:', error);
      throw error;
    }
  }

  // Get all customers with SXRX tag
  async getAllSxrxCustomers() {
    try {
      const response = await makeShopifyRequest('customers.json?tags=sxrx-user');
      return response.customers || [];
    } catch (error) {
      console.error('Error getting SXRX customers:', error);
      throw error;
    }
  }

  // Get product by ID with tags and metafields
  async getProduct(productId) {
    try {
      const productData = await makeShopifyRequest(`products/${productId}.json`);
      const product = productData.product;
      
      // Fetch metafields
      try {
        const metafieldsData = await makeShopifyRequest(`products/${productId}/metafields.json`);
        if (metafieldsData.metafields) {
          product.metafields = metafieldsData.metafields;
        }
      } catch (e) {
        console.warn(`[SHOPIFY USER SERVICE] Failed to fetch metafields for product ${productId}:`, e?.message || e);
      }
      
      return product;
    } catch (error) {
      console.error('Error getting product:', error);
      throw error;
    }
  }

  // Get all products (for filtering)
  async getAllProducts(limit = 250) {
    try {
      const response = await makeShopifyRequest(`products.json?limit=${limit}`);
      const products = response.products || [];
      
      // Fetch metafields for all products (in batches if needed)
      // Note: This could be slow for many products. Consider pagination or caching.
      for (const product of products) {
        try {
          const metafieldsData = await makeShopifyRequest(`products/${product.id}/metafields.json`);
          if (metafieldsData.metafields) {
            product.metafields = metafieldsData.metafields;
          }
        } catch (e) {
          // Non-critical, continue without metafields
          console.warn(`[SHOPIFY USER SERVICE] Failed to fetch metafields for product ${product.id}:`, e?.message || e);
        }
      }
      
      return products;
    } catch (error) {
      console.error('Error getting all products:', error);
      throw error;
    }
  }

  // Check if customer has completed questionnaire
  async hasCompletedQuestionnaire(customerId) {
    try {
      const metafields = await this.getCustomerMetafields(customerId);
      const questionnaireStatus = metafields?.questionnaire_status?.value || 
                                  metafields?.questionnaire_status ||
                                  metafields?.questionnaireStatus;
      return questionnaireStatus === 'completed';
    } catch (error) {
      console.error('Error checking questionnaire status:', error);
      return false;
    }
  }
}

module.exports = new ShopifyUserService();
