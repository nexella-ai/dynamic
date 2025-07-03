// src/services/webhooks/TypeformWebhookHandler.js - FIXED WITH BETTER FIELD EXTRACTION
const RAGMemoryService = require('../memory/RAGMemoryService');

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
    console.log('📋 Raw webhook data:', JSON.stringify(webhookData, null, 2));
    
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
      
      // Store in global for immediate access
      this.storeGlobally(customerData);
      
      // Store in memory for long-term retrieval
      if (this.memoryService && customerData.email) {
        await this.storeInMemory(customerData, formResponse);
      }
      
      // Prepare call metadata
      const callMetadata = this.prepareCallMetadata(customerData);
      
      console.log('✅ Typeform data processed successfully:', customerData);
      
      return {
        success: true,
        customerData: customerData,
        callMetadata: callMetadata
      };
      
    } catch (error) {
      console.error('❌ Error processing Typeform webhook:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract customer data from Typeform response
   */
  extractCustomerData(formResponse) {
    const answers = formResponse.answers || [];
    const customerData = {
      formId: formResponse.form_id,
      submittedAt: formResponse.submitted_at,
      responseId: formResponse.response_id || formResponse.token
    };

    console.log('📋 Processing answers:', answers.length);

    // Process each answer
    answers.forEach((answer, index) => {
      console.log(`📋 Answer ${index}:`, {
        field_id: answer.field?.id,
        field_ref: answer.field?.ref,
        field_title: answer.field?.title,
        type: answer.type,
        value: answer.text || answer.email || answer.phone_number || answer.choice?.label
      });

      const fieldRef = answer.field?.ref?.toLowerCase() || '';
      const fieldTitle = answer.field?.title?.toLowerCase() || '';
      const fieldId = answer.field?.id || '';
      
      // Log exact field title for debugging
      console.log(`🔍 Checking field: "${answer.field?.title}" (lowercase: "${fieldTitle}")`);
      
      // ENHANCED EXTRACTION LOGIC - Check multiple patterns
      
      // First Name
      if (fieldRef.includes('first_name') || 
          fieldRef.includes('firstname') || 
          fieldRef === 'first' ||
          fieldTitle.includes('first name') ||
          fieldTitle === 'first name' ||
          fieldTitle === 'what is your first name?' ||
          fieldTitle === "what's your first name?") {
        customerData.first_name = answer.text;
        console.log('✅ Found first name:', answer.text);
      } 
      // Last Name
      else if (fieldRef.includes('last_name') || 
               fieldRef.includes('lastname') || 
               fieldRef === 'last' ||
               fieldTitle.includes('last name') ||
               fieldTitle === 'last name' ||
               fieldTitle === 'what is your last name?' ||
               fieldTitle === "what's your last name?") {
        customerData.last_name = answer.text;
        console.log('✅ Found last name:', answer.text);
      }
      // Email
      else if (answer.type === 'email' || 
               fieldRef.includes('email') || 
               fieldTitle.includes('email')) {
        customerData.email = answer.email;
        console.log('✅ Found email:', answer.email);
      }
      // Phone
      else if (answer.type === 'phone_number' || 
               fieldRef.includes('phone') || 
               fieldTitle.includes('phone')) {
        customerData.phone = answer.phone_number;
        console.log('✅ Found phone:', answer.phone_number);
      }
      // Company/Business Type - EXACT MATCH FOR YOUR TYPEFORM
      else if (fieldTitle === 'what type of business do you run?' || 
               fieldTitle.includes('what type of business') || 
               fieldTitle.includes('business do you run') || 
               fieldTitle.includes('type of business') ||
               fieldTitle.includes('company name') ||
               fieldTitle.includes('business name') ||
               fieldRef.includes('business_type') || 
               fieldRef.includes('company') ||
               fieldRef.includes('business')) {
        customerData.company_name = answer.text;
        customerData.business_type = answer.text;
        console.log('✅ Found company/business:', answer.text);
      }
      // Pain Point - EXACT MATCH FOR YOUR TYPEFORM
      else if (fieldTitle === 'what are you struggling the most with?' ||
               fieldTitle.includes('what are you struggling') || 
               fieldTitle.includes('struggling the most with') ||
               fieldTitle.includes('struggling with') ||
               fieldTitle.includes('biggest challenge') ||
               fieldTitle.includes('pain point') ||
               fieldRef.includes('struggle') || 
               fieldRef.includes('pain_point') ||
               fieldRef.includes('pain') ||
               fieldRef.includes('challenge')) {
        if (answer.type === 'choice' && answer.choice) {
          customerData.pain_point = answer.choice.label;
          console.log('✅ Found pain point (choice):', answer.choice.label);
        } else if (answer.type === 'text') {
          customerData.pain_point = answer.text;
          console.log('✅ Found pain point (text):', answer.text);
        }
      }
      // Fallback: Try to detect by question position if nothing else works
      else if (!customerData.first_name && index === 0 && answer.type === 'text') {
        customerData.first_name = answer.text;
        console.log('⚠️ Assuming first field is first name:', answer.text);
      }
      else if (!customerData.last_name && index === 1 && answer.type === 'text') {
        customerData.last_name = answer.text;
        console.log('⚠️ Assuming second field is last name:', answer.text);
      }
    });

    // CRITICAL: If still missing data, try alternative extraction
    if (!customerData.first_name || !customerData.last_name || !customerData.company_name || !customerData.pain_point) {
      console.log('⚠️ Missing critical data, attempting alternative extraction...');
      
      // Look through all answers again with looser matching
      answers.forEach((answer, index) => {
        const value = answer.text || answer.email || answer.phone_number || answer.choice?.label;
        
        // If we're missing first name and this looks like a name
        if (!customerData.first_name && answer.type === 'text' && value && 
            !value.includes('@') && !value.match(/^\+?\d+$/) && 
            value.length < 30 && index < 3) {
          if (!customerData.last_name) {
            // Might be first name
            customerData.first_name = value;
            console.log('⚠️ Guessing first name:', value);
          }
        }
        
        // If we're missing company and this is a longer text answer
        if (!customerData.company_name && answer.type === 'text' && value && 
            value.length > 3 && !value.includes('@') && index > 2) {
          // Check if it's not already assigned
          if (value !== customerData.first_name && value !== customerData.last_name) {
            customerData.company_name = value;
            customerData.business_type = value;
            console.log('⚠️ Guessing company:', value);
          }
        }
        
        // If we're missing pain point and this is a choice
        if (!customerData.pain_point && answer.type === 'choice' && answer.choice?.label) {
          customerData.pain_point = answer.choice.label;
          console.log('⚠️ Found pain point in choice:', answer.choice.label);
        }
      });
    }

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

    // Log warning if critical data is missing
    if (!customerData.first_name || !customerData.pain_point) {
      console.error('⚠️ WARNING: Critical data missing!');
      console.error('⚠️ Please check Typeform field configuration');
      console.error('⚠️ Expected fields: first_name, last_name, email, phone, business type, pain point');
    }

    return customerData;
  }

  /**
   * Store customer data globally for immediate access
   */
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

  /**
   * Store customer data in RAG memory
   */
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

  /**
   * Analyze pain point and recommend services
   */
  analyzePainPoint(painPoint) {
    if (!painPoint) return [];
    
    const painPointLower = painPoint.toLowerCase();
    const recommendations = [];
    
    // Check for exact matches from your Typeform options
    if (painPointLower === "we're not generating enough leads" || 
        painPointLower.includes('not generating enough leads') ||
        painPointLower.includes('generating') && painPointLower.includes('leads')) {
      recommendations.push('AI Texting', 'SMS Revive', 'Review Collector');
    }
    
    if (painPointLower === "we're not following up with leads quickly enough" ||
        painPointLower.includes('not following up') || 
        painPointLower.includes('follow') && painPointLower.includes('quickly')) {
      recommendations.push('AI Voice Calls', 'SMS Follow-Ups', 'Appointment Bookings');
    }
    
    if (painPointLower === "we're not speaking to qualified leads" ||
        painPointLower.includes('qualified leads') || 
        painPointLower.includes('qualified')) {
      recommendations.push('AI Qualification System', 'CRM Integration');
    }
    
    if (painPointLower === "we miss calls too much" ||
        painPointLower.includes('miss calls') || 
        painPointLower.includes('missing')) {
      recommendations.push('AI Voice Calls', 'SMS Follow-Ups');
    }
    
    if (painPointLower === "we can't handle the amount of leads" ||
        painPointLower.includes("can't handle") || 
        painPointLower.includes('amount') && painPointLower.includes('leads')) {
      recommendations.push('Complete Automation Suite', 'CRM Integration');
    }
    
    if (painPointLower === "a mix of everything above" ||
        painPointLower.includes('mix') && painPointLower.includes('everything')) {
      return ['Complete AI Revenue Rescue System'];
    }
    
    return [...new Set(recommendations)];
  }

  /**
   * Prepare call metadata for AI agent
   */
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

  /**
   * Get customer data from memory by email
   */
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
