const express = require('express');
const router = express.Router();

// Placeholder for retell webhook logic
router.post('/', async (req, res) => {
  res.status(200).json({ success: true, message: 'Webhook received' });
});

module.exports = router;