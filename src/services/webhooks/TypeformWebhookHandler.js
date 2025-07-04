// src/services/webhooks/TypeformWebhookHandler.js - Updated with deduplication
const RAGMemoryService = require('../memory/RAGMemoryService');
const callDeduplicationService = require('./CallDeduplicationService');
const axios = require('axios');
const config = require('../../config/environment');

class TypeformWebhookHandler {
  constructor() {
    this.memoryService = null;
    try {
      this.memoryService = new RAGMemoryService();
      console.log('🧠 Typeform handler initialized with memory service');
    } catch (error) {
      console.log('⚠️ Memory service not available for Typeform handler');
    }
  }

  /**
   * Process incoming Typeform webhook data
   */
  async processTypeformWebhook(webhookData) {
    console.log('📋 Processing Typeform webhook data...');
    console.log('📋 Event ID:', webhookData.event_id);
    
    try {
      // Extract form response data
      const formResponse = webhookData.form_response;
      if (!formResponse) {
        console.error('❌ No form_response in webhook data');
        return { success: false, error: 'Invalid webhook format' };
      }

      // Parse answers to extract customer data
      const customerData = this.extractCustomerData(formResponse);
      
      console.log('📋 Extracted customer data:', customerData);
      
      // CRITICAL: Check for duplicate calls
      if (!callDeduplicationService.shouldAllowCall(customerData.email, customerData.responseId)) {
        console.log('🚫 DUPLICATE PREVENTION: Call already made for this submission');
        return {
          success: true,
          customerData: customerData,
          callMetadata: this.prepareCallMetadata(customerData),
          duplicate: true,
          message: 'Call already initiated for this form submission'
        };
      }
      
      // Store in global for immediate access
      this.storeGlobally(customerData);
      
      // Store in memory for long-term retrieval
      if (this.memoryService && customerData.email) {
        await this.storeInMemory(customerData, formResponse);
      }
      
      // Prepare call metadata
      const callMetadata = this.prepareCallMetadata(customerData);
      
      // Trigger the call through Retell
      const callResult = await this.triggerRetellCall(customerData);
      
      if (callResult.success) {
        // Record the call attempt
        callDeduplicationService.recordCallAttempt(
          customerData.email,
          customerData.responseId,
          callResult.callId
        );
      }
      
      console.log('✅ Typeform data processed successfully:', customerData);
      
      return {
        success: true,
        customerData: customerData,
        callMetadata: callMetadata,
        callInitiated: callResult.success,
        callId: callResult.callId
      };
      
    } catch (error) {
      console.error('❌ Error processing Typeform webhook:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger outbound call through Retell
   */
  async triggerRetellCall(customerData) {
    try {
      console.log('📞 Triggering Retell call to:', customerData.phone);
      
      // Check if we have all required data
      if (!customerData.phone || !customerData.email) {
        console.error('❌ Missing required data for call');
        return { success: false, error: 'Missing phone or email' };
      }
      
      // Make API call to Retell
      const response = await axios.post(
        'https://api.retellai.com/v2/calls/create',
        {
          agent_id: config.RETELL_AGENT_ID,
          to_number: customerData.phone,
          from_number: process.env.RETELL_FROM_NUMBER || '+1234567890', // Your Retell phone number
          metadata: {
            customer_email: customerData.email,
            customer_name: customerData.full_name,
            first_name: customerData.first_name,
            last_name: customerData.last_name,
            company_name: customerData.company_name,
            business_type: customerData.business_type,
            pain_point: customerData.pain_point,
            source: 'typeform',
            response_id: customerData.responseId
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${config.RETELL_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('✅ Retell call initiated:', response.data.call_id);
      
      return {
        success: true,
        callId: response.data.call_id
      };
      
    } catch (error) {
      console.error('❌ Error triggering Retell call:', error.response?.data || error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ... rest of your existing methods (extractCustomerData, storeGlobally, etc.) remain the same ...
  
  extractCustomerData(formResponse) {
    const answers = formResponse.answers || [];
    const fields = formResponse.definition?.fields || [];
    const customerData = {
      formId: formResponse.form_id,
      submittedAt: formResponse.submitted_at,
      responseId: formResponse.response_id || formResponse.token
    };

    console.log('📋 Processing answers:', answers.length);
    console.log('📋 Available fields:', fields.length);

    // Create a map of field IDs to field titles for easy lookup
    const fieldMap = {};
    fields.forEach(field => {
      fieldMap[field.id] = field.title;
      console.log(`📋 Field mapping: ${field.id} -> "${field.title}"`);
    });

    // Process each answer
    answers.forEach((answer, index) => {
      // Get the field title from the field map
      const fieldTitle = fieldMap[answer.field?.id] || '';
      const fieldTitleLower = fieldTitle.toLowerCase();
      const fieldRef = answer.field?.ref?.toLowerCase() || '';
      const fieldId = answer.field?.id || '';
      
      console.log(`📋 Answer ${index}:`, {
        field_id: fieldId,
        field_ref: fieldRef,
        field_title: fieldTitle,
        type: answer.type,
        value: answer.text || answer.email || answer.phone_number || answer.choice?.label || answer.choices?.labels?.join(', ')
      });
      
      // First Name (field id: BNaewCMGayfP)
      if (fieldId === 'BNaewCMGayfP' || fieldTitleLower === 'first name') {
        customerData.first_name = answer.text;
        console.log('✅ Found first name:', answer.text);
      } 
      // Last Name (field id: 17ftE77Besjh)
      else if (fieldId === '17ftE77Besjh' || fieldTitleLower === 'last name') {
        customerData.last_name = answer.text;
        console.log('✅ Found last name:', answer.text);
      }
      // Email (field id: UKLrClOAmyvT)
      else if (fieldId === 'UKLrClOAmyvT' || answer.type === 'email') {
        customerData.email = answer.email;
        console.log('✅ Found email:', answer.email);
      }
      // Phone (field id: m2rLIJQqZJcH)
      else if (fieldId === 'm2rLIJQqZJcH' || answer.type === 'phone_number') {
        customerData.phone = answer.phone_number;
        console.log('✅ Found phone:', answer.phone_number);
      }
      // Company (field id: It59o2twkQkQ)
      else if (fieldId === 'It59o2twkQkQ' || fieldTitleLower === 'company') {
        customerData.company_name = answer.text;
        console.log('✅ Found company:', answer.text);
      }
      // Business Type (field id: TMZdwl3MIETt - "What type of business do you run?")
      else if (fieldId === 'TMZdwl3MIETt' || fieldTitleLower === 'what type of business do you run?') {
        if (answer.type === 'choice' && answer.choice) {
          customerData.business_type = answer.choice.label;
          console.log('✅ Found business type:', answer.choice.label);
        }
      }
      // Pain Point (field id: XQ39O5KVKBvn - "What are you struggling the most with?")
      else if (fieldId === 'XQ39O5KVKBvn' || fieldTitleLower === 'what are you struggling the most with?') {
        if (answer.type === 'choices' && answer.choices) {
          // Multiple choice with multiple selections
          customerData.pain_point = answer.choices.labels.join(', ');
          console.log('✅ Found pain points (multiple):', customerData.pain_point);
        } else if (answer.type === 'choice' && answer.choice) {
          // Single choice
          customerData.pain_point = answer.choice.label;
          console.log('✅ Found pain point (single):', customerData.pain_point);
        }
      }
    });

    // Extract hidden fields if present
    if (formResponse.hidden) {
      Object.assign(customerData, formResponse.hidden);
    }

    // Ensure we have full name
    if (customerData.first_name || customerData.last_name) {
      customerData.full_name = `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim();
    }

    // Log final extraction results
    console.log('✅ Final extracted data:', {
      first_name: customerData.first_name || 'MISSING',
      last_name: customerData.last_name || 'MISSING',
      email: customerData.email || 'MISSING',
      phone: customerData.phone || 'MISSING',
      company_name: customerData.company_name || 'MISSING',
      business_type: customerData.business_type || 'MISSING',
      pain_point: customerData.pain_point || 'MISSING'
    });

    return customerData;
  }

  storeGlobally(customerData) {
    global.lastTypeformSubmission = {
      timestamp: new Date().toISOString(),
      email: customerData.email,
      first_name: customerData.first_name,
      last_name: customerData.last_name,
      name: customerData.full_name,
      phone: customerData.phone,
      company_name: customerData.company_name || customerData.business_type,
      business_type: customerData.business_type,
      pain_point: customerData.pain_point,
      source: 'Typeform Webhook',
      responseId: customerData.responseId
    };
    
    console.log('💾 Stored Typeform data globally:', global.lastTypeformSubmission);
  }

  async storeInMemory(customerData, formResponse) {
    if (!this.memoryService || !customerData.email) {
      return;
    }

    try {
      console.log('🧠 Storing Typeform submission in RAG memory...');
      
      // Create comprehensive memory content
      const memoryContent = `Typeform submission from ${customerData.full_name || customerData.first_name || customerData.email}
Business Type: ${customerData.business_type || customerData.company_name || 'Not specified'}
Email: ${customerData.email}
Phone: ${customerData.phone || 'Not provided'}
Struggling with: ${customerData.pain_point || 'Not specified'}
Submitted: ${new Date(customerData.submittedAt).toLocaleString()}`;

      console.log('🧠 Memory content:', memoryContent);

      // Create embedding
      const embedding = await this.memoryService.createEmbedding(memoryContent);
      
      // Store in Pinecone
      await this.memoryService.storeMemories([{
        id: `typeform_${customerData.responseId || Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'typeform_submission',
          customer_email: customerData.email,
          first_name: customerData.first_name,
          last_name: customerData.last_name,
          company_name: customerData.company_name || customerData.business_type,
          business_type: customerData.business_type,
          pain_point: customerData.pain_point,
          phone: customerData.phone,
          submitted_at: customerData.submittedAt,
          response_id: customerData.responseId,
          form_id: customerData.formId,
          timestamp: new Date().toISOString(),
          content: memoryContent
        }
      }]);

      // Also store the pain point as a separate memory
      if (customerData.pain_point) {
        const painPointContent = `${customerData.first_name || 'Customer'} who runs ${customerData.business_type || customerData.company_name || 'a business'} is struggling with: ${customerData.pain_point}`;
        const painPointEmbedding = await this.memoryService.createEmbedding(painPointContent);
        
        await this.memoryService.storeMemories([{
          id: `pain_point_${customerData.responseId}_${Date.now()}`,
          values: painPointEmbedding,
          metadata: {
            memory_type: 'pain_points',
            customer_email: customerData.email,
            customer_name: customerData.full_name || customerData.first_name,
            company_name: customerData.company_name || customerData.business_type,
            business_type: customerData.business_type,
            pain_point: customerData.pain_point,
            source: 'typeform',
            timestamp: new Date().toISOString(),
            content: painPointContent
          }
        }]);
      }

      console.log('✅ Typeform data stored in RAG memory successfully');
      
    } catch (error) {
      console.error('❌ Error storing in memory:', error);
    }
  }

  prepareCallMetadata(customerData) {
    return {
      customer_email: customerData.email,
      customer_name: customerData.full_name || `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim(),
      first_name: customerData.first_name,
      last_name: customerData.last_name,
      customer_phone: customerData.phone,
      company_name: customerData.company_name || customerData.business_type,
      business_type: customerData.business_type,
      pain_point: customerData.pain_point,
      source: 'typeform',
      typeform_response_id: customerData.responseId,
      submitted_at: customerData.submittedAt
    };
  }

  async getCustomerFromMemory(email) {
    if (!this.memoryService || !email) {
      return null;
    }

    try {
      const typeformMemories = await this.memoryService.getMemoriesByType(
        email,
        'typeform_submission',
        1
      );
      
      if (typeformMemories.length > 0) {
        return typeformMemories[0].metadata;
      }
      
      return null;
    } catch (error) {
      console.error('Error retrieving customer from memory:', error);
      return null;
    }
  }
}

module.exports = TypeformWebhookHandler;
