const express = require('express');
const axios = require('axios');
const Retell = require('retell-sdk').default; // ✅ FIXED: Changed from 'retellai' to 'retell-sdk'

const router = express.Router();

// Initialize Retell SDK client
let retellClient = null;
try {
  retellClient = new Retell({
    apiKey: process.env.RETELL_API_KEY,
  });
  console.log('✅ Retell client initialized successfully');
} catch (error) {
  console.error('❌ Error initializing Retell client:', error.message);
}

// Store active calls for tracking state
const activeCalls = new Map();

// FIXED: Updated endpoint to trigger a Retell call using SDK with enhanced call storage
router.post('/trigger-retell-call', async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing phone number field" 
      });
    }
    
    console.log('Triggering Retell call with:', { name, email, phone });
    
    // Create a unique user ID
    const userIdentifier = userId || `user_${phone}`;
    
    // First try using the SDK
    if (retellClient) {
      try {
        const response = await retellClient.call.createPhoneCall({
          from_number: process.env.RETELL_FROM_NUMBER,
          to_number: phone,
          agent_id: process.env.RETELL_AGENT_ID,
          metadata: {
            customer_name: name || "",
            customer_email: email || "", // ← CRITICAL: This must be passed
            user_id: userIdentifier,
            needs_scheduling: true,
            call_source: "website_form",
            n8n_webhook_url: process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling'
          },
          webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
          webhook_events: ["call_ended", "call_analyzed"]
        });
        
        // Store the call in our active calls map WITH COMPLETE INFO
        const callId = response.call_id;
        activeCalls.set(callId, {
          id: callId,
          phone,
          name: name || "",
          email: email || "", // ← CRITICAL: Store email here
          userId: userIdentifier,
          startTime: Date.now(),
          state: 'initiated',
          discoveryComplete: false,
          schedulingComplete: false,
          // Store metadata for easy access
          metadata: {
            customer_name: name || "",
            customer_email: email || "",
            user_id: userIdentifier
          }
        });
        
        console.log('✅ Retell outbound call initiated with SDK:', response);
        console.log('✅ Stored call data with email:', email);
        
        return res.status(200).json({
          success: true,
          message: 'Outbound call initiated successfully',
          call_id: response.call_id
        });
      } catch (sdkError) {
        console.error('❌ SDK Error initiating Retell call:', sdkError);
        // Fall through to the axios fallback
      }
    }
    
    // Fallback to direct axios call if SDK fails or isn't initialized
    try {
      const response = await axios.post('https://api.retellai.com/v1/calls', {
        from_number: process.env.RETELL_FROM_NUMBER,
        to_number: phone,
        agent_id: process.env.RETELL_AGENT_ID,
        metadata: {
          customer_name: name || "",
          customer_email: email || "", // ← CRITICAL: This must be passed
          user_id: userIdentifier,
          needs_scheduling: true,
          call_source: "website_form",
          n8n_webhook_url: process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling'
        },
        webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
        webhook_events: ["call_ended", "call_analyzed"]
      }, {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Store the call in our active calls map WITH COMPLETE INFO
      const callId = response.data.call_id;
      activeCalls.set(callId, {
        id: callId,
        phone,
        name: name || "",
        email: email || "", // ← CRITICAL: Store email here
        userId: userIdentifier,
        startTime: Date.now(),
        state: 'initiated',
        discoveryComplete: false,
        schedulingComplete: false,
        // Store metadata for easy access
        metadata: {
          customer_name: name || "",
          customer_email: email || "",
          user_id: userIdentifier
        }
      });
      
      console.log('✅ Retell outbound call initiated with axios:', response.data);
      console.log('✅ Stored call data with email:', email);
      
      return res.status(200).json({
        success: true,
        message: 'Outbound call initiated successfully',
        call_id: response.data.call_id
      });
    } catch (error) {
      console.error('❌ Error initiating Retell call:', error.response?.data || error.message);
      return res.status(500).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
  } catch (error) {
    console.error('❌ Error in trigger-retell-call endpoint:', error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// FIXED: Enhanced get-call-info endpoint
router.get('/get-call-info/:callId', (req, res) => {
  try {
    const { callId } = req.params;
    console.log(`📞 Server LLM requesting call info for: ${callId}`);
    
    // Check if we have this call in our active calls
    if (activeCalls.has(callId)) {
      const callData = activeCalls.get(callId);
      console.log(`✅ Found call data:`, callData);
      
      res.status(200).json({
        success: true,
        data: {
          name: callData.name || '',
          email: callData.email || '', // ← CRITICAL: Return the email
          phone: callData.phone || '',
          call_id: callId,
          metadata: callData.metadata || {}
        }
      });
    } else {
      console.log(`⚠️ Call ${callId} not found in active calls`);
      res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }
  } catch (error) {
    console.error('Error getting call info:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint for Retell API using the SDK
router.get('/test-retell-api', async (req, res) => {
  try {
    // First try with SDK
    if (retellClient) {
      try {
        const agents = await retellClient.agent.list();
        
        return res.status(200).json({
          success: true,
          message: 'Successfully connected to Retell API using SDK',
          agents_count: agents.agents?.length || 0,
          method: 'sdk'
        });
      } catch (sdkError) {
        console.error('❌ SDK Error connecting to Retell API:', sdkError);
        // Fall through to axios fallback
      }
    }
    
    // Fallback to axios
    if (!process.env.RETELL_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing RETELL_API_KEY environment variable"
      });
    }
    
    const response = await axios.get('https://api.retellai.com/v1/agents', {
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Successfully connected to Retell API using axios',
      agents_count: response.data.agents?.length || 0,
      method: 'axios'
    });
  } catch (error) {
    console.error('❌ Error connecting to Retell API:', error.response?.data || error.message);
    
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

module.exports = router;
