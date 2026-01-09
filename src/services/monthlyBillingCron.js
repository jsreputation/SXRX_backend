// backend/src/services/monthlyBillingCron.js
// Monthly billing cron job to process subscriptions due for billing

const cron = require('node-cron');
const subscriptionService = require('./subscriptionService');
const tebraBillingService = require('./tebraBillingService');
const tebraService = require('./tebraService');
const customerPatientMapService = require('./customerPatientMapService');
const shopifyUserService = require('./shopifyUserService');

async function processMonthlyBilling() {
  console.log('🔄 [MONTHLY BILLING] Starting monthly billing process...');
  
  try {
    // Get all subscriptions due for billing today
    const subscriptionsDue = await subscriptionService.getSubscriptionsDueForBilling();
    
    if (subscriptionsDue.length === 0) {
      console.log('ℹ️ [MONTHLY BILLING] No subscriptions due for billing today');
      return;
    }
    
    console.log(`📋 [MONTHLY BILLING] Found ${subscriptionsDue.length} subscription(s) due for billing`);
    
    const practiceId = process.env.TEBRA_PRACTICE_ID || undefined;
    const dateOfService = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const subscription of subscriptionsDue) {
      try {
        const { tebra_patient_id, amount_cents, currency, frequency, shopify_customer_id } = subscription;
        
        if (!tebra_patient_id) {
          console.warn(`⚠️ [MONTHLY BILLING] Subscription ${subscription.id} has no Tebra patient ID, skipping`);
          errorCount++;
          continue;
        }
        
        console.log(`💰 [MONTHLY BILLING] Processing subscription ${subscription.id} for patient ${tebra_patient_id}, amount: $${(amount_cents / 100).toFixed(2)}`);
        
        // Create charge in Tebra
        let tebraChargeId = null;
        let tebraPaymentId = null;
        
        if (practiceId) {
          try {
            // Create charge with generic CPT code (adjust based on your product mapping)
            const chargeResult = await tebraBillingService.createCharge({
              practiceId,
              patientId: tebra_patient_id,
              dateOfService,
              placeOfService: '10', // Telehealth
              items: [{
                cpt: '99000', // Generic CPT code - adjust based on subscription product
                units: 1,
                amountCents: amount_cents,
              }],
            });
            tebraChargeId = chargeResult.chargeId;
            console.log(`✅ [MONTHLY BILLING] Created Tebra charge ${tebraChargeId}`);
            
            // Post payment to Tebra (assuming payment was processed via Shopify subscription)
            // Note: In a real implementation, you'd need to charge the customer's payment method
            // This is a placeholder - you may need to integrate with Shopify Subscription API or Stripe
            const paymentResult = await tebraBillingService.postPayment({
              practiceId,
              patientId: tebra_patient_id,
              amountCents: amount_cents,
              referenceNumber: `SUBSCRIPTION-${subscription.id}-${Date.now()}`,
              date: dateOfService,
            });
            tebraPaymentId = paymentResult.paymentId;
            console.log(`✅ [MONTHLY BILLING] Posted Tebra payment ${tebraPaymentId}`);
          } catch (e) {
            console.error(`❌ [MONTHLY BILLING] Failed to create charge/payment for subscription ${subscription.id}:`, e?.message || e);
            // Continue to create document as fallback
          }
        }
        
        // Create billing document in Tebra
        try {
          const payload = {
            subscriptionId: subscription.id,
            shopifyCustomerId: shopify_customer_id,
            shopifyProductId: subscription.shopify_product_id,
            amount: amount_cents / 100,
            currency: currency || 'USD',
            frequency,
            tebraChargeId,
            tebraPaymentId,
            dateOfService,
            type: 'subscription_renewal',
          };
          await tebraService.createDocument({
            name: 'Billing - Subscription Renewal',
            fileName: `subscription-${subscription.id}-${dateOfService}.json`,
            label: 'Billing',
            patientId: tebra_patient_id,
            fileContent: Buffer.from(JSON.stringify(payload)).toString('base64'),
            status: 'Completed',
          });
          console.log(`✅ [MONTHLY BILLING] Created billing document for subscription ${subscription.id}`);
        } catch (e) {
          console.warn(`⚠️ [MONTHLY BILLING] Failed to create billing document for subscription ${subscription.id}:`, e?.message || e);
        }
        
        // Update subscription next billing date
        const nextBillingDate = getNextBillingDate(frequency);
        await subscriptionService.updateSubscriptionBillingDate(
          subscription.id,
          nextBillingDate,
          dateOfService
        );
        console.log(`✅ [MONTHLY BILLING] Updated subscription ${subscription.id} next billing date to ${nextBillingDate}`);
        
        successCount++;
      } catch (e) {
        console.error(`❌ [MONTHLY BILLING] Error processing subscription ${subscription.id}:`, e?.message || e);
        errorCount++;
      }
    }
    
    console.log(`✅ [MONTHLY BILLING] Billing process complete. Success: ${successCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('❌ [MONTHLY BILLING] Fatal error in monthly billing process:', error);
  }
}

function getNextBillingDate(frequency) {
  const date = new Date();
  if (frequency === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else if (frequency === 'quarterly') {
    date.setMonth(date.getMonth() + 3);
  }
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Initialize cron job
// Runs daily at 2 AM to check for subscriptions due for billing
// Cron format: minute hour day month dayOfWeek
// 0 2 * * * = At 02:00 every day
function startMonthlyBillingCron() {
  // Check if cron is enabled via environment variable
  if (process.env.ENABLE_MONTHLY_BILLING_CRON !== 'true') {
    console.log('ℹ️ [MONTHLY BILLING] Cron job disabled (ENABLE_MONTHLY_BILLING_CRON != true)');
    return null;
  }
  
  console.log('⏰ [MONTHLY BILLING] Starting monthly billing cron job (runs daily at 2 AM)');
  
  // Run daily at 2 AM
  const task = cron.schedule('0 2 * * *', async () => {
    console.log('⏰ [MONTHLY BILLING] Cron triggered at', new Date().toISOString());
    await processMonthlyBilling();
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'America/Los_Angeles',
  });
  
  // Also run immediately on startup if in development or if explicitly enabled
  if (process.env.RUN_BILLING_ON_STARTUP === 'true' || process.env.NODE_ENV === 'development') {
    console.log('🔄 [MONTHLY BILLING] Running billing process on startup...');
    processMonthlyBilling().catch(err => {
      console.error('❌ [MONTHLY BILLING] Error running billing on startup:', err);
    });
  }
  
  return task;
}

module.exports = {
  startMonthlyBillingCron,
  processMonthlyBilling,
};

