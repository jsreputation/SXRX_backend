// backend/src/controllers/paymentController.js
const Stripe = require('stripe');

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? Stripe(stripeSecret) : null;

// Normalize localhost to 127.0.0.1 for consistency (both resolve to same IP)
function normalizeLocalhost(url) {
  if (typeof url === 'string') {
    return url.replace(/localhost/gi, '127.0.0.1');
  }
  return url;
}

// Get base URL from environment or request
function getBaseUrl(req) {
  // Priority 1: Environment variable (REQUIRED for production)
  if (process.env.FRONTEND_URL) {
    const frontendUrl = normalizeLocalhost(process.env.FRONTEND_URL.replace(/\/$/, ''));
    console.log('💳 [PAYMENT] Using FRONTEND_URL from env:', frontendUrl);
    return frontendUrl;
  }
  
  // Priority 2: Try to detect from Referer or Origin header (development)
  const referer = req.get('referer') || req.get('origin');
  if (referer) {
    try {
      const url = new URL(referer);
      const requestHost = req.get('host');
      // If referer is from a different origin than backend, use it (frontend)
      if (url.origin !== `http://${requestHost}` && url.origin !== `https://${requestHost}`) {
        const normalizedOrigin = normalizeLocalhost(url.origin);
        console.log('💳 [PAYMENT] Using frontend URL from referer:', normalizedOrigin);
        return normalizedOrigin;
      }
    } catch (e) {
      console.warn('💳 [PAYMENT] Could not parse referer URL:', e.message);
    }
  }
  
  // Priority 3: Fallback to frontend dev server (common Vite port)
  // In production, this should never be reached if FRONTEND_URL is set
  // Note: http://127.0.0.1:5173 works for both localhost:5173 and 127.0.0.1:5173
  const fallback = process.env.NODE_ENV === 'production' 
    ? 'https://app.sxrx.us'  // Production fallback
    : 'http://127.0.0.1:5173';  // Development fallback (works for both localhost and 127.0.0.1)
  
  console.warn(`⚠️ [PAYMENT] FRONTEND_URL not set, using fallback: ${fallback}`);
  console.warn(`⚠️ [PAYMENT] Please set FRONTEND_URL in your .env file for production`);
  return fallback;
}

exports.createPaymentLink = async (req, res) => {
  try {
    console.log('💳 [PAYMENT] Creating payment link request');
    
    if (!stripe) {
      console.error('❌ [PAYMENT] Stripe not configured');
      return res.status(503).json({ success: false, message: 'Stripe not configured' });
    }

    const user = req.user;
    const { serviceName, description, amount, amountCents, currency = 'usd', serviceType } = req.body;

    // Validate required fields
    if (!serviceName || (!amount && !amountCents)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: serviceName and amount/amountCents are required' 
      });
    }

    // Calculate amount in cents
    let amountInCents;
    if (amountCents) {
      amountInCents = Math.round(Number(amountCents));
    } else if (amount) {
      // Handle both string and number formats
      const priceNumber = typeof amount === 'string' 
        ? Number(amount.replace(/[$,\s]/g, '').trim())
        : Number(amount);
      amountInCents = Math.round(priceNumber * 100);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Amount is required' 
      });
    }

    if (amountInCents <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Amount must be greater than 0' 
      });
    }

    console.log('💳 [PAYMENT] Creating checkout session:', {
      serviceName,
      amountInCents,
      currency,
      customerEmail: user?.email
    });

    const baseUrl = getBaseUrl(req);
    const successUrl = `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/payment-cancel`;
    
    console.log('💳 [PAYMENT] Redirect URLs:', {
      baseUrl,
      successUrl,
      cancelUrl,
      referer: req.get('referer'),
      origin: req.get('origin'),
      host: req.get('host')
    });

    // Create a Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: serviceName,
            description: description || `Payment for ${serviceName}`,
          },
          unit_amount: amountInCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user?.email || undefined, // Pre-fill customer email if available
      metadata: {
        userId: user?.id || user?.email || 'anonymous',
        customerEmail: user?.email || '',
        serviceName: serviceName,
        serviceType: serviceType || 'consultation',
      },
      // Allow promotion codes
      allow_promotion_codes: true,
    });

    console.log('✅ [PAYMENT] Checkout session created:', session.id);

    return res.json({ 
      success: true,
      sessionId: session.id,
      paymentLink: session.url,
      checkoutUrl: session.url
    });
  } catch (error) {
    console.error('❌ [PAYMENT] Error creating payment link:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to create payment link',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};
