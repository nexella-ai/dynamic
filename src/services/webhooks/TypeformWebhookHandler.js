// src/services/webhooks/TypeformWebhookHandler.js - ENHANCED TYPEFORM DATA HANDLER
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
    
    try {
      // Extract form response data
      const formResponse = webhookData.form_response;
      if (!formResponse) {
        console.error('❌ No form_response in webhook data');
        return { success: false, error: 'Invalid webhook format' };
      }

      // Parse answers to extract customer data
      const customerData = this.extractCustomerData(formResponse);
      
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
      responseId: formResponse.response_id
    };

    // Map Typeform field IDs to data fields
    const fieldMapping = {
      'first_name': ['first_name', 'fname', 'firstname'],
      'last_name': ['last_name', 'lname', 'lastname'],
      'email': ['email', 'email_address'],
      'phone': ['phone', 'phone_number', 'mobile'],
      'company_name': ['company', 'company_name', 'business_name'],
      'pain_point': ['struggle', 'pain_point', 'challenge', 'problem']
    };

    // Process each answer
    answers.forEach(answer => {
      const fieldId = answer.field?.id;
      const fieldRef = answer.field?.ref;
      const fieldTitle = answer.field?.title?.toLowerCase() || '';
      
      // Check field mappings
      for (const [dataField, possibleRefs] of Object.entries(fieldMapping)) {
        if (possibleRefs.some(ref => fieldRef?.includes(ref) || fieldTitle.includes(ref))) {
          // Extract value based on answer type
          switch (answer.type) {
            case 'text':
              customerData[dataField] = answer.text;
              break;
            case 'email':
              customerData.email = answer.email;
              break;
            case 'phone_number':
              customerData.phone = answer.phone_number;
              break;
            case 'choice':
              if (dataField === 'pain_point') {
                customerData.pain_point = answer.choice?.label || answer.choice?.other;
              } else {
                customerData[dataField] = answer.choice?.label;
              }
              break;
          }
        }
      }
      
      // Special handling for the pain point question
      if (fieldTitle.includes('struggling') || fieldTitle.includes('challenge') || 
          fieldTitle.includes('problem') || fieldRef === 'pain_point') {
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

    // Ensure we have full name if first/last are provided
    if (customerData.first_name || customerData.last_name) {
      customerData.full_name = `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim();
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
      company_name: customerData.company_name,
      pain_point: customerData.pain_point,
      source: 'Typeform Webhook',
      responseId: customerData.responseId
    };
    
    console.log('💾 Stored Typeform data globally for immediate access');
  }

  /**
   * Store customer data in RAG memory for long-term retrieval
   */
  async storeInMemory(customerData, formResponse) {
    if (!this.memoryService || !customerData.email) {
      return;
    }

    try {
      console.log('🧠 Storing Typeform submission in RAG memory...');
      
      // Create comprehensive memory content
      const memoryContent = `Typeform submission from ${customerData.full_name || customerData.email}
Company: ${customerData.company_name || 'Not specified'}
Email: ${customerData.email}
Phone: ${customerData.phone || 'Not provided'}
Struggling with: ${customerData.pain_point || 'Not specified'}
Submitted: ${new Date(customerData.submittedAt).toLocaleString()}`;

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
          company_name: customerData.company_name,
          pain_point: customerData.pain_point,
          phone: customerData.phone,
          submitted_at: customerData.submittedAt,
          response_id: customerData.responseId,
          form_id: customerData.formId,
          timestamp: new Date().toISOString(),
          content: memoryContent
        }
      }]);

      // Also store the pain point as a separate memory for better retrieval
      if (customerData.pain_point) {
        const painPointContent = `${customerData.first_name} from ${customerData.company_name} is struggling with: ${customerData.pain_point}`;
        const painPointEmbedding = await this.memoryService.createEmbedding(painPointContent);
        
        await this.memoryService.storeMemories([{
          id: `pain_point_${customerData.responseId}_${Date.now()}`,
          values: painPointEmbedding,
          metadata: {
            memory_type: 'pain_points',
            customer_email: customerData.email,
            customer_name: customerData.full_name,
            company_name: customerData.company_name,
            pain_point: customerData.pain_point,
            source: 'typeform',
            timestamp: new Date().toISOString(),
            content: painPointContent
          }
        }]);
      }

      // Analyze pain point and store recommended services
      const recommendedServices = this.analyzePainPoint(customerData.pain_point);
      if (recommendedServices.length > 0) {
        const recommendationContent = `Recommended Nexella AI services for ${customerData.full_name}: ${recommendedServices.join(', ')} to address: ${customerData.pain_point}`;
        const recommendationEmbedding = await this.memoryService.createEmbedding(recommendationContent);
        
        await this.memoryService.storeMemories([{
          id: `recommendation_${customerData.responseId}_${Date.now()}`,
          values: recommendationEmbedding,
          metadata: {
            memory_type: 'service_recommendation',
            customer_email: customerData.email,
            recommended_services: recommendedServices,
            pain_point: customerData.pain_point,
            timestamp: new Date().toISOString(),
            content: recommendationContent
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
    
    if (painPointLower.includes('not generating enough leads') || 
        painPointLower.includes('leads') && painPointLower.includes('enough')) {
      recommendations.push('AI Texting', 'SMS Revive', 'Review Collector');
    }
    
    if (painPointLower.includes('not following up') || 
        painPointLower.includes('follow') && painPointLower.includes('quickly')) {
      recommendations.push('AI Voice Calls', 'SMS Follow-Ups', 'Appointment Bookings');
    }
    
    if (painPointLower.includes('qualified leads') || 
        painPointLower.includes('not speaking to qualified')) {
      recommendations.push('AI Qualification System', 'CRM Integration');
    }
    
    if (painPointLower.includes('miss calls') || 
        painPointLower.includes('missing calls')) {
      recommendations.push('AI Voice Calls', 'SMS Follow-Ups');
    }
    
    if (painPointLower.includes("can't handle") || 
        painPointLower.includes('amount of leads') ||
        painPointLower.includes('volume')) {
      recommendations.push('Complete Automation Suite', 'CRM Integration');
    }
    
    if (painPointLower.includes('mix of everything') || 
        painPointLower.includes('all of the above')) {
      return ['Complete AI Revenue Rescue System'];
    }
    
    return [...new Set(recommendations)]; // Remove duplicates
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
      company_name: customerData.company_name,
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
