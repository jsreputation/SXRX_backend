// Simple mapping from US state to Tebra practice/provider configuration
// Extend as needed; values typically come from environment variables or admin UI
module.exports = {
  CA: {
    state: 'CA',
    practiceId: process.env.TEBRA_PRACTICE_ID_CA || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_CA || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_CA || undefined,
    allowKetamine: false,
  },
  TX: {
    state: 'TX',
    practiceId: process.env.TEBRA_PRACTICE_ID_TX || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_TX || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_TX || undefined,
    allowKetamine: true,
  },
  WA: {
    state: 'WA',
    practiceId: process.env.TEBRA_PRACTICE_ID_WA || process.env.TEBRA_PRACTICE_ID || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_WA || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_WA || process.env.TEBRA_PROVIDER_ID || undefined,
    allowKetamine: false,
  },
  KL: {
    state: 'KL',
    practiceId: process.env.TEBRA_PRACTICE_ID_KL || process.env.TEBRA_PRACTICE_ID || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_KL || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_KL || process.env.TEBRA_PROVIDER_ID || undefined,
    allowKetamine: false,
  },
};



