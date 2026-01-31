const moment = require('moment-timezone');
const axios = require('axios');
const { getShopifyDomain } = require('../utils/shopifyDomain');
const SHOPIFY_STORE = getShopifyDomain();
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
exports.getProducts = async (req, res) => {
    try {
        const response = await axios.get(`https://${SHOPIFY_STORE}/admin/api/2024-01/products.json`, {
            headers: {
                "X-Shopify-Access-Token": ACCESS_TOKEN,
                "Content-Type": "application/json",
            },
        });
        console.log('here');
        res.json(response.data);
    } catch (error) {
        console.error('Error details:', error.response?.data || error.message);
        res.status(500).json({ message: error.message });
  }
};

exports.getProductById = async (req, res) => {
  try {
    const response = await axios.get(`https://${SHOPIFY_STORE}/admin/api/2024-01/products/${req.params.id}.json`, {
      headers: {
        "X-Shopify-Access-Token": ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const response = await axios.post(`https://${SHOPIFY_STORE}/admin/api/2024-01/products.json`, req.body, {
      headers: {
        "X-Shopify-Access-Token": ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateProductStatus = async (req, res) => {
  try {
    const response = await axios.put(`https://${SHOPIFY_STORE}/admin/api/2024-01/products/${req.params.id}.json`, req.body, {
      headers: {
        "X-Shopify-Access-Token": ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const response = await axios.delete(`https://${SHOPIFY_STORE}/admin/api/2024-01/products/${req.params.id}.json`, {
        headers: {
            "X-Shopify-Access-Token": ACCESS_TOKEN,
            "Content-Type": "application/json",
        },
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getOrders = async (req, res) => {
  console.log('here');
  try {
    const response = await axios.get(`https://${SHOPIFY_STORE}/admin/api/2024-01/orders.json`, {
      headers: {
        "X-Shopify-Access-Token": ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error details:', error.response?.data || error.message);
    res.status(500).json({ message: error.message });
  }
};
