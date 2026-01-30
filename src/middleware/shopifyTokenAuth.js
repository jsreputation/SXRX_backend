// backend/src/middleware/shopifyTokenAuth.js
// Secure auth middleware supporting either Backend JWT sessions (Authorization: Bearer <jwt>)
// or Shopify Customer Access Tokens provided via `shopify_access_token` header.
//
// Notes:
// - We validate JWTs with JWT_SECRET.
// - We validate Shopify Customer tokens by calling Storefront GraphQL `customer(customerAccessToken: $token)`.
// - Minimal in-memory cache prevents repeated validations (do not log secrets).

const jwt = require('jsonwebtoken');
const axios = require('axios');

const tokenCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function cacheGet(key) {
  const hit = tokenCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_DURATION) {
    tokenCache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value) {
  tokenCache.set(key, { at: Date.now(), value });
}

function verifyJwtToken(token) {
  try {
    if (!token) return null;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Short-circuit if embedded Shopify token is known expired
    if (payload.shopifyExpiresAt) {
      const expTs = new Date(payload.shopifyExpiresAt).getTime();
      if (!Number.isNaN(expTs) && Date.now() > expTs) {
        const e = new Error('Shopify session expired');
        e.status = 401;
        throw e;
      }
    }
    const principalId = payload.sub || payload.id || payload.customerId;
    return {
      authType: 'jwt',
      id: principalId,
      email: payload.email,
      role: payload.role || 'customer',
      shopifyAccessToken: payload.shopifyAccessToken, // expose for downstream controllers (e.g., /me)
      payload,
    };
  } catch (_) {
    return null;
  }
}

async function verifyJwtBearer(authHeader) {
  try {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    return verifyJwtToken(token);
  } catch (_) {
    return null;
  }
}

async function verifyJwtCookie(cookieToken) {
  try {
    return verifyJwtToken(cookieToken);
  } catch (_) {
    return null;
  }
}

async function verifyShopifyCustomerToken(customerAccessToken) {
  if (!customerAccessToken) return null;
  const cached = cacheGet(`sfc:${customerAccessToken}`);
  if (cached) return cached;

  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE;
  const sfToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';
  if (!storeDomain || !sfToken) return null;

  const url = `https://${storeDomain}/api/${apiVersion}/graphql.json`;
  const query = `#graphql
    query VerifyCustomer($token: String!) {
      customer(customerAccessToken: $token) {
        id
        email
        firstName
        lastName
      }
    }
  `;
  try {
    const res = await axios.post(
      url,
      { query, variables: { token: customerAccessToken } },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': sfToken,
        },
        timeout: 7000,
      }
    );
    const customer = res?.data?.data?.customer;
    if (customer && customer.email) {
      const principal = {
        authType: 'shopify_customer_token',
        email: customer.email,
        name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        shopifyCustomerId: customer.id,
        role: 'customer',
        shopifyAccessToken: customerAccessToken,
      };
      cacheSet(`sfc:${customerAccessToken}`, principal);
      return principal;
    }
    return null;
  } catch (err) {
    return null;
  }
}

const auth = async (req, res, next) => {
  try {
    // 1) Try JWT first
    const bearer = req.header('Authorization');
    const jwtPrincipal = await verifyJwtBearer(bearer);
    if (jwtPrincipal) {
      req.user = jwtPrincipal;
      return next();
    }

    // 2) Fallback: JWT from HttpOnly cookie
    const cookieToken = req.cookies?.sxrx_jwt;
    const cookiePrincipal = await verifyJwtCookie(cookieToken);
    if (cookiePrincipal) {
      req.user = cookiePrincipal;
      return next();
    }

    // 3) Fallback: Shopify Customer Access Token in custom header
    const shopifyToken = req.header('shopify_access_token');
    const sfPrincipal = await verifyShopifyCustomerToken(shopifyToken);
    if (sfPrincipal) {
      req.user = sfPrincipal;
      return next();
    }

    return res.status(401).json({
      success: false,
      message: 'Unauthorized: valid JWT or Shopify customer token required',
    });
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// Optional auth - tries to authenticate but doesn't fail if no token provided
// Useful for customer account pages where authentication might not be available
const optionalAuth = async (req, res, next) => {
  try {
    // 1) Try JWT first
    const bearer = req.header('Authorization');
    const jwtPrincipal = await verifyJwtBearer(bearer);
    if (jwtPrincipal) {
      req.user = jwtPrincipal;
      return next();
    }

    // 2) Fallback: JWT from HttpOnly cookie
    const cookieToken = req.cookies?.sxrx_jwt;
    const cookiePrincipal = await verifyJwtCookie(cookieToken);
    if (cookiePrincipal) {
      req.user = cookiePrincipal;
      return next();
    }

    // 3) Fallback: Shopify Customer Access Token in custom header
    const shopifyToken = req.header('shopify_access_token');
    const sfPrincipal = await verifyShopifyCustomerToken(shopifyToken);
    if (sfPrincipal) {
      req.user = sfPrincipal;
      return next();
    }

    // No auth found - continue without user (for customer account pages)
    req.user = null;
    next();
  } catch (error) {
    // Auth failed - continue without user (for customer account pages)
    req.user = null;
    next();
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
};

const clearTokenCache = () => {
  tokenCache.clear();
};

const getCacheStats = () => {
  const entries = [];
  for (const [k, v] of tokenCache.entries()) entries.push({ key: k.slice(0, 8) + '***', ageMs: Date.now() - v.at });
  return { size: tokenCache.size, entries };
};

module.exports = { auth, optionalAuth, authorize, clearTokenCache, getCacheStats };
