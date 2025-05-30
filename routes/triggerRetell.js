const express = require('express');
const router = express.Router();
const { storeContactInfoGlobally } = require('../utils/contactStorage');
const axios = require('axios');
const { RETELL_API_KEY, RETELL_AGENT_ID } = require('../config');

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;

    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    storeContactInfoGlobally(name, email, phone, 'API Call');

    const response = await axios.post(
      'https://api.retellai.com/v1/calls',
      {
        agent_id: RETELL_AGENT_ID,
        customer_number: phone,
        variables: { customer_name: name || '', customer_email: email },
        metadata: { customer_name: name || '', customer_email: email, customer_phone: phone || '' }
      },
      {
        headers: {
          'Authorization': `Bearer ${RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).json({ success: true, call_id: response.data.call_id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;