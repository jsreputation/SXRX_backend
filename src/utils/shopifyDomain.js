function normalizeShopifyDomain(value) {
  if (!value) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return trimmed;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return new URL(trimmed).hostname;
    }
  } catch (e) {}
  return trimmed.replace(/\/+$/, '');
}

function getShopifyDomain() {
  return normalizeShopifyDomain(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE);
}

module.exports = { normalizeShopifyDomain, getShopifyDomain };
