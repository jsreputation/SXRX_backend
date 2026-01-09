// backend/src/routes/billing.js
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/shopifyTokenAuth');
const controller = require('../controllers/billingSummaryController');
const { query } = require('../db/pg');

router.get('/summary', auth, controller.summary);

// Sync payment from Stripe checkout session (for development/testing when webhooks aren't available)
router.post('/sync-session', auth, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const user = req.user;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }

    const Stripe = require('stripe');
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      return res.status(503).json({ success: false, message: 'Stripe not configured' });
    }
    const stripe = Stripe(stripeSecret);

    console.log('💳 [BILLING SYNC] Syncing checkout session:', sessionId);
    
    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Checkout session not found' });
    }

    // Extract payment details
    const email = session.customer_details?.email || session.customer_email || user?.email;
    const amountCents = session.amount_total || 0;
    const paymentIntentId = session.payment_intent?.id || session.payment_intent || null;
    const currency = session.currency || 'usd';

    console.log('💳 [BILLING SYNC] Session details:', {
      email,
      amountCents,
      paymentIntentId,
      currency
    });

    // Check if a billing record already exists for this payment intent
    const billingSync = require('../services/billingSyncService');
    const tebra = require('../services/tebraService');
    
    // Find or create patient
    let patientId = null;
    if (email) {
      try {
        const result = await tebra.searchPatients({ email });
        const arr = result?.patients || result?.Patients || [];
        if (arr.length > 0) {
          patientId = arr[0].Id || arr[0].id || arr[0].ID || null;
        }
      } catch (e) {
        console.warn('⚠️ [BILLING SYNC] Could not search patients:', e.message);
      }
    }

    const practiceId = process.env.TEBRA_PRACTICE_ID || undefined;
    
    // Upsert billing record by payment intent ID (prevents duplicates)
    // This will update existing record if payment intent already exists, or create new one
    try {
      const existingRecord = await billingSync.upsertByPaymentIntentId(paymentIntentId, {
        stripe_event_id: `evt_sync_${sessionId}_${Date.now()}`, // Only used if creating new record
        stripe_customer_email: email,
        tebra_patient_id: patientId,
        tebra_practice_id: practiceId,
        amount_cents: amountCents,
        currency: currency,
        status: 'received'
      });
      
      console.log('💳 [BILLING SYNC] Record upserted by payment intent ID:', paymentIntentId);

      // Check if this was an update (existing record) or new insert
      // If the event ID doesn't start with our generated pattern, it was an existing record
      const wasExisting = existingRecord.stripe_event_id && !existingRecord.stripe_event_id.startsWith('evt_sync_');
      
      console.log('✅ [BILLING SYNC] Manual sync completed for session:', sessionId, wasExisting ? '(updated existing)' : '(created new)');
      
      return res.json({ 
        success: true, 
        message: wasExisting ? 'Payment record updated (duplicate prevented)' : 'Payment synced successfully',
        sessionId,
        eventId: existingRecord.stripe_event_id,
        wasExisting: wasExisting
      });
    } catch (e) {
      console.error('❌ [BILLING SYNC] Error syncing session:', e);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to sync payment',
        error: process.env.NODE_ENV === 'development' ? e?.message : undefined
      });
    }
  } catch (error) {
    console.error('❌ [BILLING SYNC] Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to sync payment',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
});

// Retry a failed billing sync for a given Stripe event id
router.post('/retry-sync/:eventId', auth, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const billingSync = require('../services/billingSyncService');
    const tebraBilling = require('../services/tebraBillingService');
    const tebra = require('../services/tebraService');

    const row = await billingSync.getByEventId(eventId);
    if (!row) return res.status(404).json({ success: false, message: 'Event not found' });

    const practiceId = row.tebra_practice_id || process.env.TEBRA_PRACTICE_ID || undefined;
    const useMock = String(process.env.USE_TEBRA_MOCK||'').toLowerCase()==='true';
    
    // If no practice ID and not using mock, try to continue anyway (will fail gracefully)
    if (!practiceId && !useMock) {
      console.warn('⚠️ [BILLING RETRY] Missing TEBRA_PRACTICE_ID, but continuing with sync attempt');
    }

    // If we have no patient id try to resolve by email from row
    let patientId = row.tebra_patient_id;
    if (!patientId && row.stripe_customer_email) {
      try {
        const found = await tebra.searchPatients({ email: row.stripe_customer_email });
        const arr = found?.patients || found?.Patients || [];
        const match = arr.find(p => (p.Email || p.email || '').toLowerCase() === row.stripe_customer_email.toLowerCase());
        patientId = match?.ID || match?.Id || match?.id || null;
      } catch {}
    }
    if (!patientId) {
      console.warn('⚠️ [BILLING RETRY] Cannot resolve patient for event, but continuing with sync attempt');
      // Continue anyway - Tebra sync will fail, but at least we tried
    }

    const totalCents = row.amount_cents | 0;
    let chargeId = null, paymentId = null, status = 'stored';
    let errorMsg = null;
    
    try {
      if (!useMock) {
        // Note: CreateCharge and PostPayment may not be available in Tebra SOAP API
        // Attempt sync, but gracefully handle if methods don't exist
        try {
          console.log('💳 [BILLING RETRY] Attempting to create charge in Tebra...');
          const cRes = await tebraBilling.createCharge({ 
            practiceId, 
            patientId, 
            items: [{ cpt:'99213', modifier:'95', units:1, amountCents: totalCents }], 
            dateOfService: new Date().toISOString().slice(0,10), 
            placeOfService:'10' 
          });
          chargeId = cRes.chargeId || null;
          console.log('✅ [BILLING RETRY] Charge created:', chargeId);
          
          console.log('💳 [BILLING RETRY] Attempting to post payment to Tebra...');
          const pRes = await tebraBilling.postPayment({ 
            practiceId, 
            patientId, 
            amountCents: totalCents, 
            referenceNumber: row.stripe_payment_intent_id || row.stripe_event_id, 
            date: new Date().toISOString().slice(0,10) 
          });
          paymentId = pRes.paymentId || null;
          console.log('✅ [BILLING RETRY] Payment posted:', paymentId);
          
          status = 'synced';
        } catch (soapError) {
          // Check if it's a contract mismatch (method doesn't exist)
          const isContractMismatch = /ContractFilter|Action.*cannot be processed/i.test(soapError?.message || '');
          
          if (isContractMismatch) {
            errorMsg = 'Tebra SOAP API does not support CreateCharge/PostPayment methods. Billing sync may require manual entry or different API.';
            console.warn('⚠️ [BILLING RETRY] Tebra billing methods not available:', errorMsg);
            status = 'stored'; // Keep as stored since sync isn't possible
          } else {
            throw soapError; // Re-throw other errors
          }
        }
      } else {
        // Mock mode
        chargeId = `MOCK-CHG-${Date.now()}`;
        paymentId = `MOCK-PMT-${Date.now()}`;
        status = 'synced-mock';
      }
      
      await billingSync.updateByEventId(eventId, { 
        tebra_patient_id: patientId, 
        tebra_practice_id: practiceId || null, 
        tebra_charge_id: chargeId, 
        tebra_payment_id: paymentId, 
        status, 
        error: errorMsg || null 
      });
      
      return res.json({ 
        success: true, 
        status, 
        chargeId, 
        paymentId,
        message: errorMsg || 'Payment synced successfully',
        warning: errorMsg ? 'Tebra billing sync not available via SOAP API' : undefined
      });
    } catch (e) {
      const errorMessage = e?.message || String(e);
      console.error('❌ [BILLING RETRY] Sync failed:', errorMessage);
      await billingSync.updateByEventId(eventId, { 
        status: 'stored', 
        error: errorMessage 
      });
      return res.status(502).json({ 
        success: false, 
        message: 'Retry failed', 
        error: errorMessage 
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
});

module.exports = router;
