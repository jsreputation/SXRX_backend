// backend/src/controllers/billingSummaryController.js
const { auth } = require('../middleware/shopifyTokenAuth');
const billingSync = require('../services/billingSyncService');

exports.summary = async (req, res) => {
  try {
    console.log('📋 [BILLING SUMMARY] Request received');
    console.log('📋 [BILLING SUMMARY] Request headers:', {
      authorization: req.headers.authorization ? 'present' : 'missing',
      'content-type': req.headers['content-type']
    });
    
    const user = req.user;
    console.log('📋 [BILLING SUMMARY] User from req.user:', {
      hasUser: !!user,
      hasEmail: !!user?.email,
      email: user?.email,
      authType: user?.authType,
      userObject: user ? Object.keys(user) : null
    });
    
    if (!user || !user.email) {
      console.error('❌ [BILLING SUMMARY] Unauthorized - missing user or email');
      console.error('❌ [BILLING SUMMARY] req.user value:', req.user);
      return res.status(401).json({ success: false, message: 'Unauthorized: user email required' });
    }
    
    console.log('📋 [BILLING SUMMARY] Fetching billing records for email:', user.email);
    
    // Try to fetch billing records with timeout
    let rows;
    try {
      rows = await Promise.race([
        billingSync.getRecentForEmail(user.email, 25),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout after 10 seconds')), 10000)
        )
      ]);
    } catch (dbError) {
      console.error('❌ [BILLING SUMMARY] Database query failed:', dbError);
      console.error('❌ [BILLING SUMMARY] Database error details:', {
        message: dbError?.message,
        code: dbError?.code,
        name: dbError?.name
      });
      
      // Check if it's a connection error
      if (dbError?.code === 'ECONNREFUSED' || dbError?.message?.includes('connect')) {
        return res.status(503).json({ 
          success: false, 
          message: 'Database connection failed. Please check your database configuration.',
          error: process.env.NODE_ENV === 'development' ? dbError?.message : undefined
        });
      }
      
      // Re-throw to be caught by outer catch
      throw dbError;
    }
    
    console.log('✅ [BILLING SUMMARY] Found', rows?.length || 0, 'billing records');
    
    return res.json({ success: true, items: rows || [] });
  } catch (e) {
    console.error('❌ [BILLING SUMMARY] Error:', e);
    console.error('❌ [BILLING SUMMARY] Error stack:', e?.stack);
    console.error('❌ [BILLING SUMMARY] Error message:', e?.message);
    console.error('❌ [BILLING SUMMARY] Error name:', e?.name);
    console.error('❌ [BILLING SUMMARY] Error code:', e?.code);
    
    const errorMessage = e?.message || 'Internal server error';
    const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    
    return res.status(500).json({ 
      success: false, 
      message: 'Internal error',
      error: isDevelopment ? errorMessage : undefined,
      details: isDevelopment ? {
        name: e?.name,
        code: e?.code,
        stack: e?.stack
      } : undefined
    });
  }
};
