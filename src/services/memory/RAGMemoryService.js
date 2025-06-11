// src/services/memory/RAGMemoryService.js - Complete RAG Memory System
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const config = require('../../config/environment');

class RAGMemoryService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.OPENAI_API_KEY
    });
    
    this.pinecone = new Pinecone({
      apiKey: config.PINECONE_API_KEY
    });
    
    this.index = null;
    this.embeddingModel = 'text-embedding-3-large'; // Latest OpenAI model
    this.embeddingDimensions = 3072; // Dimensions for text-embedding-3-large
    
    this.initialize();
  }

  async initialize() {
    try {
      // Initialize Pinecone index
      this.index = this.pinecone.index(config.PINECONE_INDEX_NAME);
      console.log('✅ RAG Memory System initialized');
    } catch (error) {
      console.error('❌ RAG Memory initialization failed:', error.message);
    }
  }

  // CORE MEMORY FUNCTIONS

  /**
   * Store conversation memory with embeddings
   */
  async storeConversationMemory(callId, customerData, conversationData, discoveryData) {
    try {
      console.log('💾 Storing conversation memory for:', callId);
      
      // Create comprehensive memory document
      const memoryDocument = this.createMemoryDocument(callId, customerData, conversationData, discoveryData);
      
      // Generate embeddings for different aspects
      const memories = await this.generateMemoryEmbeddings(memoryDocument);
      
      // Store in vector database
      await this.storeMemories(memories);
      
      console.log('✅ Conversation memory stored successfully');
      return { success: true, memoriesStored: memories.length };
      
    } catch (error) {
      console.error('❌ Error storing conversation memory:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Retrieve relevant memories for current conversation
   */
  async retrieveRelevantMemories(customerEmail, currentQuery, limit = 5) {
    try {
      console.log('🔍 Retrieving memories for:', customerEmail);
      
      // Generate embedding for current query
      const queryEmbedding = await this.createEmbedding(currentQuery);
      
      // Search for relevant memories
      const searchResults = await this.index.query({
        vector: queryEmbedding,
        filter: {
          customer_email: { $eq: customerEmail }
        },
        topK: limit,
        includeMetadata: true
      });
      
      // Process and format results
      const relevantMemories = this.processSearchResults(searchResults);
      
      console.log(`✅ Retrieved ${relevantMemories.length} relevant memories`);
      return relevantMemories;
      
    } catch (error) {
      console.error('❌ Error retrieving memories:', error.message);
      return [];
    }
  }

  /**
   * Get customer context for personalized responses
   */
  async getCustomerContext(customerEmail) {
    try {
      // Retrieve customer's conversation history
      const customerMemories = await this.index.query({
        vector: new Array(this.embeddingDimensions).fill(0), // Dummy vector
        filter: {
          customer_email: { $eq: customerEmail },
          memory_type: { $eq: 'customer_profile' }
        },
        topK: 10,
        includeMetadata: true
      });
      
      return this.buildCustomerProfile(customerMemories);
      
    } catch (error) {
      console.error('❌ Error getting customer context:', error.message);
      return null;
    }
  }

  // MEMORY CREATION AND PROCESSING

  createMemoryDocument(callId, customerData, conversationData, discoveryData) {
    const timestamp = new Date().toISOString();
    
    return {
      callId,
      timestamp,
      customer: {
        email: customerData.customerEmail,
        name: customerData.customerName,
        phone: customerData.customerPhone
      },
      conversation: {
        duration: conversationData.duration || 'unknown',
        questionsCompleted: conversationData.questionsCompleted || 0,
        schedulingCompleted: conversationData.schedulingCompleted || false,
        userSentiment: conversationData.userSentiment || 'neutral'
      },
      discovery: discoveryData || {},
      metadata: {
        source: 'ai_call_agent',
        version: '1.0'
      }
    };
  }

  async generateMemoryEmbeddings(memoryDocument) {
    const memories = [];
    
    // 1. Customer Profile Memory
    const customerProfile = `Customer: ${memoryDocument.customer.name} (${memoryDocument.customer.email}). 
      Business: ${memoryDocument.discovery['What industry or business are you in?'] || 'Unknown'}. 
      Product/Service: ${memoryDocument.discovery['What\'s your main product or service?'] || 'Unknown'}`;
    
    memories.push({
      id: `${memoryDocument.callId}_profile`,
      values: await this.createEmbedding(customerProfile),
      metadata: {
        memory_type: 'customer_profile',
        customer_email: memoryDocument.customer.email,
        customer_name: memoryDocument.customer.name,
        timestamp: memoryDocument.timestamp,
        content: customerProfile,
        call_id: memoryDocument.callId
      }
    });

    // 2. Business Context Memory
    if (memoryDocument.discovery['What industry or business are you in?']) {
      const businessContext = `${memoryDocument.customer.name} works in ${memoryDocument.discovery['What industry or business are you in?']}. 
        Their main offering is ${memoryDocument.discovery['What\'s your main product or service?'] || 'not specified'}.
        Current advertising: ${memoryDocument.discovery['Are you currently running any ads?'] || 'not specified'}.
        CRM usage: ${memoryDocument.discovery['Are you using any CRM system?'] || 'not specified'}`;
      
      memories.push({
        id: `${memoryDocument.callId}_business`,
        values: await this.createEmbedding(businessContext),
        metadata: {
          memory_type: 'business_context',
          customer_email: memoryDocument.customer.email,
          industry: memoryDocument.discovery['What industry or business are you in?'],
          timestamp: memoryDocument.timestamp,
          content: businessContext,
          call_id: memoryDocument.callId
        }
      });
    }

    // 3. Pain Points Memory
    if (memoryDocument.discovery['What are your biggest pain points or challenges?']) {
      const painPoints = `${memoryDocument.customer.name}'s biggest challenges: ${memoryDocument.discovery['What are your biggest pain points or challenges?']}`;
      
      memories.push({
        id: `${memoryDocument.callId}_painpoints`,
        values: await this.createEmbedding(painPoints),
        metadata: {
          memory_type: 'pain_points',
          customer_email: memoryDocument.customer.email,
          timestamp: memoryDocument.timestamp,
          content: painPoints,
          call_id: memoryDocument.callId
        }
      });
    }

    // 4. Interaction Summary
    const interactionSummary = `Call with ${memoryDocument.customer.name} on ${memoryDocument.timestamp}. 
      Completed ${memoryDocument.conversation.questionsCompleted}/6 discovery questions. 
      Scheduling: ${memoryDocument.conversation.schedulingCompleted ? 'completed' : 'not completed'}.
      How they heard about us: ${memoryDocument.discovery['How did you hear about us?'] || 'not specified'}`;
    
    memories.push({
      id: `${memoryDocument.callId}_interaction`,
      values: await this.createEmbedding(interactionSummary),
      metadata: {
        memory_type: 'interaction_summary',
        customer_email: memoryDocument.customer.email,
        timestamp: memoryDocument.timestamp,
        content: interactionSummary,
        questions_completed: memoryDocument.conversation.questionsCompleted,
        scheduling_completed: memoryDocument.conversation.schedulingCompleted,
        call_id: memoryDocument.callId
      }
    });

    return memories;
  }

  async storeMemories(memories) {
    try {
      // Batch upsert to Pinecone
      await this.index.upsert(memories);
      console.log(`✅ Stored ${memories.length} memory embeddings`);
    } catch (error) {
      console.error('❌ Error storing memories:', error.message);
      throw error;
    }
  }

  async createEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: text,
        dimensions: this.embeddingDimensions
      });
      
      return response.data[0].embedding;
    } catch (error) {
      console.error('❌ Error creating embedding:', error.message);
      throw error;
    }
  }

  // RETRIEVAL AND PROCESSING

  processSearchResults(searchResults) {
    return searchResults.matches?.map(match => ({
      score: match.score,
      memoryType: match.metadata.memory_type,
      content: match.metadata.content,
      timestamp: match.metadata.timestamp,
      callId: match.metadata.call_id,
      relevance: this.calculateRelevance(match.score),
      metadata: match.metadata
    })) || [];
  }

  calculateRelevance(score) {
    if (score > 0.9) return 'very_high';
    if (score > 0.8) return 'high';
    if (score > 0.7) return 'medium';
    if (score > 0.6) return 'low';
    return 'very_low';
  }

  buildCustomerProfile(customerMemories) {
    const profile = {
      totalInteractions: 0,
      lastInteraction: null,
      industry: null,
      product: null,
      painPoints: [],
      preferences: {},
      conversationHistory: []
    };

    customerMemories.matches?.forEach(match => {
      const metadata = match.metadata;
      
      profile.totalInteractions++;
      
      if (!profile.lastInteraction || new Date(metadata.timestamp) > new Date(profile.lastInteraction)) {
        profile.lastInteraction = metadata.timestamp;
      }
      
      if (metadata.memory_type === 'business_context') {
        profile.industry = metadata.industry;
      }
      
      if (metadata.memory_type === 'pain_points') {
        profile.painPoints.push(metadata.content);
      }
      
      profile.conversationHistory.push({
        callId: metadata.call_id,
        timestamp: metadata.timestamp,
        type: metadata.memory_type,
        content: metadata.content
      });
    });

    return profile;
  }

  // ENHANCED RETRIEVAL METHODS

  /**
   * Get memories by type (customer_profile, business_context, pain_points, interaction_summary)
   */
  async getMemoriesByType(customerEmail, memoryType, limit = 5) {
    try {
      const results = await this.index.query({
        vector: new Array(this.embeddingDimensions).fill(0),
        filter: {
          customer_email: { $eq: customerEmail },
          memory_type: { $eq: memoryType }
        },
        topK: limit,
        includeMetadata: true
      });
      
      return this.processSearchResults(results);
    } catch (error) {
      console.error(`❌ Error getting ${memoryType} memories:`, error.message);
      return [];
    }
  }

  /**
   * Search across all customers for similar business contexts
   */
  async findSimilarCustomers(industry, painPoints, limit = 3) {
    try {
      const queryText = `Industry: ${industry}. Pain points: ${painPoints.join(', ')}`;
      const queryEmbedding = await this.createEmbedding(queryText);
      
      const results = await this.index.query({
        vector: queryEmbedding,
        filter: {
          memory_type: { $eq: 'business_context' }
        },
        topK: limit,
        includeMetadata: true
      });
      
      return this.processSearchResults(results);
    } catch (error) {
      console.error('❌ Error finding similar customers:', error.message);
      return [];
    }
  }

  /**
   * Generate conversation context for AI agent
   */
  async generateConversationContext(customerEmail, currentQuery) {
    try {
      // Get relevant memories
      const memories = await this.retrieveRelevantMemories(customerEmail, currentQuery, 3);
      
      // Get customer profile
      const profile = await this.getCustomerContext(customerEmail);
      
      // Generate context string
      let context = '';
      
      if (profile && profile.totalInteractions > 0) {
        context += `Previous interactions: ${profile.totalInteractions}. `;
        if (profile.industry) context += `Industry: ${profile.industry}. `;
        if (profile.painPoints.length > 0) {
          context += `Known pain points: ${profile.painPoints.slice(0, 2).join(', ')}. `;
        }
      }
      
      if (memories.length > 0) {
        context += 'Recent relevant memories: ';
        memories.forEach((memory, index) => {
          if (index < 2) { // Limit to 2 most relevant
            context += `${memory.content}. `;
          }
        });
      }
      
      return context.trim();
      
    } catch (error) {
      console.error('❌ Error generating conversation context:', error.message);
      return '';
    }
  }

  // NEXELLA-SPECIFIC METHODS

  /**
   * Match Nexella services to customer pain points
   */
  async matchServicesToPainPoints(painPoints) {
    const services = [];
    const painPointsLower = painPoints.toLowerCase();
    
    if (painPointsLower.includes('lead') || painPointsLower.includes('follow up') || 
        painPointsLower.includes('response') || painPointsLower.includes('slow')) {
      services.push('SMS Revive', 'AI Texting', 'SMS Follow-Ups');
    }
    
    if (painPointsLower.includes('appointment') || painPointsLower.includes('booking') || 
        painPointsLower.includes('schedule') || painPointsLower.includes('calendar')) {
      services.push('Appointment Bookings', 'AI Voice Calls');
    }
    
    if (painPointsLower.includes('support') || painPointsLower.includes('customer service') || 
        painPointsLower.includes('overwhelmed')) {
      services.push('AI Voice Calls', 'AI Texting');
    }
    
    if (painPointsLower.includes('review') || painPointsLower.includes('feedback') || 
        painPointsLower.includes('reputation')) {
      services.push('Review Collector');
    }
    
    if (painPointsLower.includes('crm') || painPointsLower.includes('integration') || 
        painPointsLower.includes('system')) {
      services.push('CRM Integration');
    }
    
    if (painPointsLower.includes('dead leads') || painPointsLower.includes('old leads') || 
        painPointsLower.includes('cold leads')) {
      services.push('SMS Revive');
    }
    
    return [...new Set(services)]; // Remove duplicates
  }

  /**
   * Generate enhanced conversation context with Nexella knowledge
   */
  async generateEnhancedConversationContext(customerEmail, currentQuery) {
    try {
      let context = '';
      
      // Get customer history
      if (customerEmail && customerEmail !== 'prospect@example.com') {
        const customerMemories = await this.retrieveRelevantMemories(customerEmail, currentQuery, 2);
        
        if (customerMemories.length > 0) {
          context += 'CUSTOMER HISTORY: ';
          customerMemories.forEach(memory => {
            context += `${memory.content}. `;
          });
        }
      }
      
      // Get relevant Nexella knowledge
      const nexellaQueryEmbedding = await this.createEmbedding(currentQuery);
      const nexellaKnowledge = await this.index.query({
        vector: nexellaQueryEmbedding,
        filter: {
          source: { $eq: 'nexella_knowledge' }
        },
        topK: 2,
        includeMetadata: true
      });
      
      if (nexellaKnowledge.matches && nexellaKnowledge.matches.length > 0) {
        context += '\nRELEVANT NEXELLA INFO: ';
        nexellaKnowledge.matches.forEach(match => {
          if (match.metadata.answer) {
            context += `${match.metadata.answer}. `;
          } else if (match.metadata.content) {
            context += `${match.metadata.content}. `;
          }
        });
      }
      
      return context.trim();
      
    } catch (error) {
      console.error('❌ Error generating enhanced context:', error.message);
      return this.generateConversationContext(customerEmail, currentQuery); // Fallback to original method
    }
  }

  /**
   * Store conversation with Nexella service recommendations
   */
  async storeEnhancedConversationMemory(callId, customerData, conversationData, discoveryData) {
    try {
      // First store using the original method
      const baseResult = await this.storeConversationMemory(callId, customerData, conversationData, discoveryData);
      
      // Then add Nexella-specific recommendations
      if (discoveryData['Pain points']) {
        const recommendedServices = await this.matchServicesToPainPoints(discoveryData['Pain points']);
        
        if (recommendedServices.length > 0) {
          const recommendationContent = `Based on ${customerData.customerName}'s pain points: "${discoveryData['Pain points']}", 
            Nexella AI recommends these services: ${recommendedServices.join(', ')}. 
            These services directly address their challenges with automated solutions.`;
          
          const recommendationEmbedding = await this.createEmbedding(recommendationContent);
          
          await this.storeMemories([{
            id: `${callId}_nexella_recommendations`,
            values: recommendationEmbedding,
            metadata: {
              memory_type: 'service_recommendation',
              customer_email: customerData.customerEmail,
              customer_name: customerData.customerName,
              timestamp: new Date().toISOString(),
              content: recommendationContent,
              call_id: callId,
              recommended_services: recommendedServices,
              pain_points: discoveryData['Pain points']
            }
          }]);
          
          console.log('✅ Stored Nexella service recommendations:', recommendedServices);
        }
      }
      
      return baseResult;
      
    } catch (error) {
      console.error('❌ Error storing enhanced conversation memory:', error.message);
      // Fallback to original method
      return this.storeConversationMemory(callId, customerData, conversationData, discoveryData);
    }
  }

  // MAINTENANCE AND UTILITIES

  /**
   * Update customer information
   */
  async updateCustomerInfo(customerEmail, updates) {
    try {
      // This would typically involve updating metadata and potentially re-embedding
      console.log(`🔄 Updating customer info for: ${customerEmail}`, updates);
      // Implementation depends on specific update requirements
    } catch (error) {
      console.error('❌ Error updating customer info:', error.message);
    }
  }

  /**
   * Delete customer memories (GDPR compliance)
   */
  async deleteCustomerMemories(customerEmail) {
    try {
      // Delete all memories for a customer
      await this.index.deleteMany({
        filter: {
          customer_email: { $eq: customerEmail }
        }
      });
      
      console.log(`✅ Deleted all memories for: ${customerEmail}`);
    } catch (error) {
      console.error('❌ Error deleting customer memories:', error.message);
    }
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats() {
    try {
      const stats = await this.index.describeIndexStats();
      return {
        totalVectors: stats.totalVectorCount,
        dimension: stats.dimension,
        indexFullness: stats.indexFullness
      };
    } catch (error) {
      console.error('❌ Error getting memory stats:', error.message);
      return null;
    }
  }
}

module.exports = RAGMemoryService;
