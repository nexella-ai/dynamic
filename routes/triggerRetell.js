const express = require('express');
const router = express.Router();
const { storeContactInfoGlobally } = require('../utils/contactStorage');
const Retell = require('retell-sdk').default;
const { RETELL_API_KEY, RETELL_AGENT_ID } = require('../config');

const client = new RetellClient({ apiKey: RETELL_API_KEY });

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;

    if (!email || !phone) {
      return res.status(400).json({ success: false, error: 'Email and phone are required' });
    }

    storeContactInfoGlobally(name, email, phone, 'API Call');

    const call = await client.calls.create({
      agentId: RETELL_AGENT_ID,
      customerNumber: phone,
      variables: {
        customer_name: name || '',
        customer_email: email
      },
      metadata: {
        customer_name: name || '',
        customer_email: email,
        customer_phone: phone || ''
      }
    });

    console.log('[Retell SDK] Call triggered:', call);
    res.status(200).json({ success: true, call_id: call.callId });
  } catch (error) {
    console.error('[Retell SDK] Error:', error.message || error);
    res.status(500).json({ success: false, error: error.message || 'Retell call failed' });
  }
});

module.exports = router;
