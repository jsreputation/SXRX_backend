const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { auth } = require('../middleware/shopifyAuth');

// Get all appointments for a user (patient)
router.get('/', productController.getProducts);

// Get all orders
router.get('/orders', productController.getOrders);

// Get all appointments for a doctor
router.get('/:id', productController.getProductById);

// Create a new appointment
router.post('/', productController.createProduct);

// Update appointment status    
router.put('/:id', productController.updateProductStatus);

// Cancel appointment
router.delete('/:id', productController.deleteProduct);


module.exports = router; 