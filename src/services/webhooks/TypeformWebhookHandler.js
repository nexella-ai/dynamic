// src/services/webhooks/TypeformWebhookHandler.js - FIXED FOR YOUR TYPEFORM QUESTIONS
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
      
      // Extract based on field reference or title
      if (fieldRef.includes('first_name') || fieldTitle.includes('first name')) {
        customerData.first_name = answer.text;
      } 
      else if (fieldRef.includes('last_name') || fieldTitle.includes('last name')) {
        customerData.last_name = answer.text;
      }
      else if (fieldRef.includes('email') || answer.type === 'email') {
        customerData.email = answer.email;
      }
      else if (fieldRef.includes('phone') || answer.type === 'phone_number') {
        customerData.phone = answer.phone_number;
      }
      // FIXED: Check for "What type of business do you run?"
      else if (fieldTitle.includes('what type of business') || fieldTitle.includes('business do you run') || 
               fieldRef.includes('business_type') || fieldRef.includes('company')) {
        customerData.company_name = answer.text;
        customerData.business_type = answer.text; // Store as both
      }
      // FIXED: Check for "What are you struggling the most with?"
      else if (fieldTitle.includes('what are you struggling') || fieldTitle.includes('struggling the most with') ||
               fieldRef.includes('struggle') || fieldRef.includes('pain_point')) {
        if (answer.type === 'choice') {
          customerData.pain_point = answer.choice?.label;
        } else if (answer.type === 'text') {
          customerData.pain_point = answer.text;
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

    // Log what we found
    console.log('✅ Final extracted data:', {
      first_name: customerData.first_name,
      last_name: customerData.last_name,
      email: customerData.email,
      company_name: customerData.company_name,
      business_type: customerData.business_type,
      pain_point: customerData.pain_point
    });

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
      const memoryContent = `Typeform submission from ${customerData.full_name || customerData.email}
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
        const painPointContent = `${customerData.first_name} who runs ${customerData.business_type || customerData.company_name} is struggling with: ${customerData.pain_point}`;
        const painPointEmbedding = await this.memoryService.createEmbedding(painPointContent);
        
        await this.memoryService.storeMemories([{
          id: `pain_point_${customerData.responseId}_${Date.now()}`,
          values: painPointEmbedding,
          metadata: {
            memory_type: 'pain_points',
            customer_email: customerData.email,
            customer_name: customerData.full_name,
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
      customer_name: customerData.full_name,
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
