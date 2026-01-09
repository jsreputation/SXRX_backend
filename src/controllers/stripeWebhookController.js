// backend/src/controllers/stripeWebhookController.js
const Stripe = require('stripe');
const tebraService = require('../services/tebraService');

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecret ? Stripe(stripeSecret) : null;

function getEmailFromEvent(event) {
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      return s.customer_details?.email || s.customer_email || s.metadata?.email || null;
    }
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      return pi.receipt_email || pi.metadata?.email || null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function findOrCreatePatientByEmail(email) {
  if (!email) return null;
  try {
    if (tebraService.searchPatients) {
      const result = await tebraService.searchPatients({ email });
      const arr = result?.patients || result?.Patients || [];
      const match = arr.find(p => (p.Email || p.email || '').toLowerCase() === email.toLowerCase());
      if (match) return match.ID || match.Id || match.id;
    }
  } catch (e) {
    console.warn('StripeWebhook: searchPatients failed:', e?.message || e);
  }
  // As last resort, create a minimal patient (unknown name)
  try {
    const created = await tebraService.createPatient({ email, firstName: 'Unknown', lastName: 'Unknown' });
    return created?.id || created?.PatientID || created?.patientId || null;
  } catch (e) {
    console.warn('StripeWebhook: failed to create patient:', e?.message || e);
    return null;
  }
}

async function createPaymentDocument({ patientId, practiceId, payload }) {
  const doc = {
    name: 'Payment Receipt',
    fileName: `payment-${payload.id || Date.now()}.json`,
    documentDate: new Date().toISOString(),
    status: 'Completed',
    label: 'Payment',
    notes: `Stripe payment ${payload.id} — ${payload.amount_total || payload.amount || ''}`,
    patientId,
    practiceId,
    fileContent: Buffer.from(JSON.stringify(payload)).toString('base64'),
  };
  return tebraService.createDocument(doc);
}

// Simple idempotency cache for processed Stripe event IDs (replace with persistent store if needed)
const processedEvents = new Map(); // eventId -> timestamp
const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function markProcessed(eventId) {
  processedEvents.set(eventId, Date.now());
}
function isProcessed(eventId) {
  const ts = processedEvents.get(eventId);
  if (!ts) return false;
  if (Date.now() - ts > EVENT_TTL_MS) {
    processedEvents.delete(eventId);
    return false;
  }
  return true;
}

exports.handleStripe = async (req, res) => {
  try {
    console.log('💳 [STRIPE WEBHOOK] Received webhook request');
    
    if (!stripe || !stripeWebhookSecret) {
      console.error('❌ [STRIPE WEBHOOK] Stripe not configured');
      return res.status(503).json({ success: false, message: 'Stripe not configured' });
    }
    
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, stripeWebhookSecret);
      console.log('✅ [STRIPE WEBHOOK] Event verified:', event.type, event.id);
    } catch (err) {
      console.error('❌ [STRIPE WEBHOOK] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle only relevant events
    const handled = ['checkout.session.completed', 'payment_intent.succeeded'];
    if (!handled.includes(event.type)) {
      console.log('ℹ️ [STRIPE WEBHOOK] Ignoring event type:', event.type);
      return res.json({ received: true, ignored: true, type: event.type });
    }
    
    console.log('📋 [STRIPE WEBHOOK] Processing event:', event.type);

    // Idempotency: skip if already processed (DB + in-memory)
    try {
      const billingSync = require('../services/billingSyncService');
      const existing = await billingSync.getByEventId(event.id);
      if (existing && (existing.status === 'synced' || existing.status === 'synced-mock')) {
        return res.json({ received: true, duplicate: true, status: existing.status });
      }
    } catch (_) {}
    if (isProcessed(event.id)) {
      return res.json({ received: true, duplicate: true });
    }

    const email = getEmailFromEvent(event);
    console.log('📧 [STRIPE WEBHOOK] Extracted email:', email);
    
    const patientId = await findOrCreatePatientByEmail(email);
    console.log('👤 [STRIPE WEBHOOK] Patient ID:', patientId || 'not found');

    const practiceId = process.env.TEBRA_PRACTICE_ID || undefined;
    const obj = event.data.object || {};
    const amountCents = (obj.amount_total ?? obj.amount ?? 0) | 0;
    console.log('💰 [STRIPE WEBHOOK] Payment amount:', amountCents / 100, obj.currency || 'usd');

    // Persist basic record early - use payment intent ID for deduplication
    try {
      const billingSync = require('../services/billingSyncService');
      const paymentIntentId = obj.id || obj.payment_intent || null;
      
      // Use upsertByPaymentIntentId to prevent duplicates
      if (paymentIntentId) {
        await billingSync.upsertByPaymentIntentId(paymentIntentId, {
          stripe_event_id: event.id, // Use actual webhook event ID
          stripe_customer_email: email || null,
          tebra_patient_id: patientId || null,
          tebra_practice_id: practiceId || null,
          amount_cents: amountCents,
          currency: obj.currency || 'usd',
          status: 'received'
        });
        console.log('✅ [STRIPE WEBHOOK] Initial billing record saved/updated by payment intent ID');
      } else {
        // Fallback to event ID if no payment intent ID
        await billingSync.upsertByEventId(event.id, {
          stripe_payment_intent_id: null,
          stripe_customer_email: email || null,
          tebra_patient_id: patientId || null,
          tebra_practice_id: practiceId || null,
          amount_cents: amountCents,
          currency: obj.currency || 'usd',
          status: 'received'
        });
        console.log('✅ [STRIPE WEBHOOK] Initial billing record saved by event ID (no payment intent ID)');
      }
    } catch (e) {
      console.error('❌ [STRIPE WEBHOOK] Initial billing_sync upsert failed:', e?.message || e);
    }

    if (!patientId) {
      console.warn('⚠️ [STRIPE WEBHOOK] No patientId resolved for email:', email);
      markProcessed(event.id);
      return res.json({ received: true, patientLinked: false, email });
    }

    // Always store a receipt document in Tebra for audit
    try {
      console.log('📄 [STRIPE WEBHOOK] Creating payment document in Tebra...');
      await createPaymentDocument({ patientId, practiceId, payload: obj });
      console.log('✅ [STRIPE WEBHOOK] Payment document created');
    } catch (e) {
      console.warn('⚠️ [STRIPE WEBHOOK] Failed to create payment document:', e?.message || e);
    }

    // Create Tebra charge + post payment (best-effort)
    const useMock = String(process.env.USE_TEBRA_MOCK || '').toLowerCase() === 'true';
    let chargeId = null;
    let paymentId = null;
    let status = 'stored';
    let errorMsg = null;
    
    console.log('💳 [STRIPE WEBHOOK] Starting Tebra billing sync (mock:', useMock, ')...');
    try {
      const { createCharge, postPayment } = require('../services/tebraBillingService');

      // Default CPT mapping: bill as 99213 with modifier 95 for telemedicine
      const items = [ { cpt: '99213', modifier: '95', units: 1, amountCents: amountCents } ];

      if (!useMock) {
        try {
          console.log('📋 [STRIPE WEBHOOK] Creating charge in Tebra...');
          const cRes = await createCharge({ 
            practiceId, 
            patientId, 
            items, 
            dateOfService: new Date().toISOString().slice(0,10), 
            placeOfService: '10' 
          });
          chargeId = cRes.chargeId || null;
          console.log('✅ [STRIPE WEBHOOK] Charge created:', chargeId);
          
          console.log('📋 [STRIPE WEBHOOK] Posting payment to Tebra...');
          const pRes = await postPayment({ 
            practiceId, 
            patientId, 
            amountCents: amountCents, 
            referenceNumber: obj.id || obj.payment_intent || '', 
            date: new Date().toISOString().slice(0,10) 
          });
          paymentId = pRes.paymentId || null;
          console.log('✅ [STRIPE WEBHOOK] Payment posted:', paymentId);
          status = 'synced';
        } catch (soapError) {
          // Check if it's a contract mismatch (methods don't exist in Tebra SOAP API)
          const isContractMismatch = /ContractFilter|Action.*cannot be processed/i.test(soapError?.message || '');
          
          if (isContractMismatch) {
            errorMsg = 'Tebra SOAP API does not support CreateCharge/PostPayment. Payment stored but not synced.';
            console.warn('⚠️ [STRIPE WEBHOOK] Tebra billing methods not available:', errorMsg);
            status = 'stored'; // Payment received but sync not possible
          } else {
            throw soapError; // Re-throw other errors
          }
        }
      } else {
        // Mock mode: pretend successful sync
        chargeId = `MOCK-CHG-${Date.now()}`;
        paymentId = `MOCK-PMT-${Date.now()}`;
        status = 'synced-mock';
        console.log('✅ [STRIPE WEBHOOK] Mock sync completed');
      }
    } catch (e) {
      errorMsg = e?.message || String(e);
      console.error('❌ [STRIPE WEBHOOK] Tebra billing sync failed:', errorMsg);
      console.error('❌ [STRIPE WEBHOOK] Error details:', {
        code: e?.code,
        response: e?.response
      });
      status = 'stored';
    }

    try {
      const billingSync = require('../services/billingSyncService');
      const paymentIntentId = obj.id || obj.payment_intent || null;
      
      // Use upsertByPaymentIntentId to prevent duplicates
      if (paymentIntentId) {
        await billingSync.upsertByPaymentIntentId(paymentIntentId, {
          stripe_event_id: event.id, // Use actual webhook event ID
          stripe_customer_email: email || null,
          tebra_patient_id: patientId,
          tebra_practice_id: practiceId || null,
          tebra_charge_id: chargeId || null,
          tebra_payment_id: paymentId || null,
          amount_cents: amountCents,
          currency: obj.currency || 'usd',
          status,
          error: errorMsg || null,
        });
        console.log('✅ [STRIPE WEBHOOK] Final billing record updated by payment intent ID with status:', status);
      } else {
        // Fallback to event ID if no payment intent ID
        await billingSync.upsertByEventId(event.id, {
          stripe_payment_intent_id: null,
          stripe_customer_email: email || null,
          tebra_patient_id: patientId,
          tebra_practice_id: practiceId || null,
          tebra_charge_id: chargeId || null,
          tebra_payment_id: paymentId || null,
          amount_cents: amountCents,
          currency: obj.currency || 'usd',
          status,
          error: errorMsg || null,
        });
        console.log('✅ [STRIPE WEBHOOK] Final billing record updated by event ID with status:', status);
      }
    } catch (e) {
      console.error('❌ [STRIPE WEBHOOK] Finalize billing_sync upsert failed:', e?.message || e);
    }

    markProcessed(event.id);
    console.log('✅ [STRIPE WEBHOOK] Webhook processing complete:', {
      eventId: event.id,
      status,
      chargeId,
      paymentId
    });
    
    return res.json({ 
      success: true, 
      patientId, 
      stored: true, 
      chargeId, 
      paymentId, 
      status,
      amount: amountCents / 100,
      currency: obj.currency || 'usd'
    });
  } catch (error) {
    console.error('❌ [STRIPE WEBHOOK] Unexpected error:', error);
    console.error('❌ [STRIPE WEBHOOK] Error stack:', error?.stack);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};
