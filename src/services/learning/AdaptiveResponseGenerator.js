// src/services/learning/AdaptiveResponseGenerator.js
const axios = require('axios');
const config = require('../../config/environment');
const SelfScoringLearningModule = require('./SelfScoringLearningModule');

class AdaptiveResponseGenerator {
  constructor(memoryService) {
    this.memoryService = memoryService;
    this.learningModule = new SelfScoringLearningModule();
    
    // Response generation parameters
    this.contextWindow = 5; // Number of previous messages to consider
    this.temperatureAdjustment = 0.1; // How much to adjust based on performance
    this.baseTemperature = 0.7;
    
    // Cache for performance
    this.responseCache = new Map();
    this.strategyCache = new Map();
  }

  /**
   * Generate an adaptive response based on learnings
   */
  async generateAdaptiveResponse(conversationState, userMessage) {
    try {
      // Get optimal strategy based on learnings
      const strategy = await this.getOptimalResponseStrategy(conversationState);
      
      // Get similar successful responses
      const successfulPatterns = await this.findSuccessfulResponsePatterns(
        conversationState,
        userMessage
      );
      
      // Build enhanced prompt with learnings
      const enhancedPrompt = await this.buildEnhancedPrompt(
        conversationState,
        userMessage,
        strategy,
        successfulPatterns
      );
      
      // Generate response with adaptive parameters
      const response = await this.generateResponseWithLearnings(
        enhancedPrompt,
        strategy
      );
      
      // Track response for future learning
      this.trackResponsePerformance(conversationState, userMessage, response);
      
      return response;
      
    } catch (error) {
      console.error('❌ Error generating adaptive response:', error);
      // Fallback to standard response generation
      return this.generateStandardResponse(conversationState, userMessage);
    }
  }

  /**
   * Get optimal response strategy based on current state
   */
  async getOptimalResponseStrategy(conversationState) {
    const cacheKey = `${conversationState.phase}_${conversationState.industry}_${conversationState.painPoint}`;
    
    // Check cache first
    if (this.strategyCache.has(cacheKey)) {
      return this.strategyCache.get(cacheKey);
    }
    
    // Get strategy from learning module
    const strategy = await this.learningModule.getOptimalStrategy(
      conversationState.customerProfile,
      conversationState.phase
    );
    
    if (strategy) {
      // Apply real-time adjustments based on current conversation
      const adjustedStrategy = this.adjustStrategyForCurrentContext(
        strategy,
        conversationState
      );
      
      this.strategyCache.set(cacheKey, adjustedStrategy);
      return adjustedStrategy;
    }
    
    // Default strategy if none found
    return this.getDefaultStrategy(conversationState.phase);
  }

  /**
   * Find successful response patterns from similar situations
   */
  async findSuccessfulResponsePatterns(conversationState, userMessage) {
    try {
      // Build search query
      const searchQuery = `${conversationState.phase} ${conversationState.industry} ${userMessage} successful response`;
      
      // Search for similar successful interactions
      const results = await this.memoryService.index.query({
        vector: await this.memoryService.createEmbedding(searchQuery),
        filter: {
          memory_type: { $eq: 'successful_response' },
          phase: { $eq: conversationState.phase },
          score: { $gte: 80 }
        },
        topK: 3,
        includeMetadata: true
      });
      
      // Extract patterns
      const patterns = results.matches?.map(match => ({
        response: match.metadata.response_text,
        context: match.metadata.context,
        outcome: match.metadata.outcome,
        score: match.score,
        keyPhrases: JSON.parse(match.metadata.key_phrases || '[]')
      })) || [];
      
      return patterns;
      
    } catch (error) {
      console.error('Error finding response patterns:', error);
      return [];
    }
  }

  /**
   * Build enhanced prompt with learnings
   */
  async buildEnhancedPrompt(conversationState, userMessage, strategy, patterns) {
    let prompt = conversationState.baseSystemPrompt || '';
    
    // Add learned strategy guidance
    if (strategy && strategy.confidence > 0.7) {
      prompt += `\n\nRECOMMENDED APPROACH (based on ${strategy.confidence * 100}% success rate):
${strategy.strategy}`;
      
      if (strategy.pattern.keyPhrases) {
        prompt += `\nEffective phrases to use: ${strategy.pattern.keyPhrases.join(', ')}`;
      }
    }
    
    // Add successful pattern examples
    if (patterns.length > 0) {
      prompt += '\n\nSUCCESSFUL RESPONSE PATTERNS FROM SIMILAR SITUATIONS:';
      patterns.slice(0, 2).forEach((pattern, index) => {
        prompt += `\nExample ${index + 1} (${pattern.score * 100}% relevance):
Context: ${pattern.context}
Response: ${pattern.response}
Outcome: ${pattern.outcome}`;
      });
    }
    
    // Add specific guidance based on conversation metrics
    const liveScore = await this.learningModule.calculateLiveScore(conversationState);
    if (liveScore < 60) {
      prompt += '\n\nCONVERSATION NEEDS IMPROVEMENT. Focus on:';
      
      if (!conversationState.painPointAcknowledged) {
        prompt += '\n- Acknowledge their pain point explicitly';
      }
      if (conversationState.questionsCompleted < 3) {
        prompt += '\n- Ask more discovery questions naturally';
      }
      if (!conversationState.customerEngaged) {
        prompt += '\n- Show more enthusiasm and ask engaging questions';
      }
    }
    
    // Add conversation history
    prompt += '\n\nCONVERSATION HISTORY:';
    conversationState.recentHistory.forEach(msg => {
      prompt += `\n${msg.role}: ${msg.content}`;
    });
    
    prompt += `\n\nUser just said: "${userMessage}"`;
    prompt += '\n\nYour response (applying the successful patterns and recommendations):';
    
    return prompt;
  }

  /**
   * Generate response with learned parameters
   */
  async generateResponseWithLearnings(prompt, strategy) {
    // Adjust temperature based on strategy confidence
    let temperature = this.baseTemperature;
    if (strategy && strategy.confidence > 0.8) {
      temperature -= this.temperatureAdjustment; // Be more consistent with proven strategies
    } else if (!strategy || strategy.confidence < 0.5) {
      temperature += this.temperatureAdjustment; // Be more creative when uncertain
    }
    
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            { role: 'system', content: prompt }
          ],
          temperature: temperature,
          max_tokens: 150,
          presence_penalty: 0.1,
          frequency_penalty: 0.1
        },
        {
          headers: {
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return response.data.choices[0].message.content.trim();
      
    } catch (error) {
      console.error('Error calling OpenAI:', error);
      throw error;
    }
  }

  /**
   * Track response performance for learning
   */
  trackResponsePerformance(conversationState, userMessage, response) {
    // Store for later analysis when call completes
    if (!conversationState.responseTracking) {
      conversationState.responseTracking = [];
    }
    
    conversationState.responseTracking.push({
      phase: conversationState.phase,
      userMessage: userMessage,
      aiResponse: response,
      timestamp: new Date().toISOString(),
      contextScore: conversationState.currentScore || 50
    });
  }

  /**
   * Store successful response pattern after call completion
   */
  async storeSuccessfulResponse(callData, response, outcome) {
    if (outcome.score < 80) return; // Only store high-scoring responses
    
    try {
      const content = `Successful response in ${response.phase}: "${response.aiResponse}" 
Led to: ${outcome.result}. 
Context: User said "${response.userMessage}".
Industry: ${callData.industry}. Pain point: ${callData.painPoint}`;

      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `successful_response_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'successful_response',
          phase: response.phase,
          user_message: response.userMessage,
          response_text: response.aiResponse,
          context: `${callData.industry} - ${callData.painPoint}`,
          outcome: outcome.result,
          score: outcome.score,
          key_phrases: this.extractKeyPhrases(response.aiResponse),
          call_id: callData.callId,
          timestamp: response.timestamp,
          content: content
        }
      }]);
      
    } catch (error) {
      console.error('Error storing successful response:', error);
    }
  }

  /**
   * Adjust strategy based on current conversation dynamics
   */
  adjustStrategyForCurrentContext(strategy, conversationState) {
    const adjusted = { ...strategy };
    
    // Adjust based on customer engagement level
    if (conversationState.customerEngagement === 'low') {
      adjusted.strategy = `${strategy.strategy} Focus on asking engaging questions to increase participation.`;
      adjusted.confidence *= 0.9; // Slightly lower confidence due to low engagement
    }
    
    // Adjust based on time in conversation
    if (conversationState.duration > 300 && !conversationState.schedulingOffered) {
      adjusted.strategy = `${strategy.strategy} Consider moving towards scheduling soon.`;
    }
    
    // Adjust based on repeated patterns
    if (conversationState.repeatedQuestions > 0) {
      adjusted.strategy = `${strategy.strategy} Avoid repeating questions already asked.`;
    }
    
    return adjusted;
  }

  /**
   * Get default strategy for phase
   */
  getDefaultStrategy(phase) {
    const defaults = {
      greeting: {
        strategy: 'Warm greeting with name, ask how they are doing',
        confidence: 0.6
      },
      rapport: {
        strategy: 'Build connection, acknowledge their industry/company',
        confidence: 0.6
      },
      discovery: {
        strategy: 'Ask open-ended questions about their challenges',
        confidence: 0.6
      },
      pain_point: {
        strategy: 'Show empathy and understanding of their specific challenge',
        confidence: 0.6
      },
      solution: {
        strategy: 'Present relevant Nexella services that address their pain points',
        confidence: 0.6
      },
      scheduling: {
        strategy: 'Offer specific time slots and create urgency',
        confidence: 0.6
      }
    };
    
    return defaults[phase] || { strategy: 'Continue conversation naturally', confidence: 0.5 };
  }

  /**
   * Generate standard response (fallback)
   */
  async generateStandardResponse(conversationState, userMessage) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: conversationState.baseSystemPrompt },
          ...conversationState.recentHistory,
          { role: 'user', content: userMessage }
        ],
        temperature: this.baseTemperature,
        max_tokens: 150
      },
      {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.choices[0].message.content.trim();
  }

  /**
   * Extract key phrases from response
   */
  extractKeyPhrases(response) {
    // Simple extraction - could be enhanced with NLP
    const phrases = [];
    
    // Common effective phrases
    const effectivePhrases = [
      'I understand', 'That makes sense', 'I can help with that',
      'Let me show you', 'specifically for you', 'solve this',
      'Many of our clients', 'similar situation', 'great results'
    ];
    
    effectivePhrases.forEach(phrase => {
      if (response.toLowerCase().includes(phrase.toLowerCase())) {
        phrases.push(phrase);
      }
    });
    
    return phrases;
  }

  /**
   * Learn from completed conversation
   */
  async learnFromConversation(callData, finalScore) {
    if (!callData.responseTracking) return;
    
    // Analyze each response's contribution to outcome
    for (let i = 0; i < callData.responseTracking.length; i++) {
      const response = callData.responseTracking[i];
      const nextResponse = callData.responseTracking[i + 1];
      
      // Determine response effectiveness
      let effectiveness = 'neutral';
      if (nextResponse) {
        // Check if conversation improved after this response
        if (nextResponse.contextScore > response.contextScore) {
          effectiveness = 'positive';
        } else if (nextResponse.contextScore < response.contextScore) {
          effectiveness = 'negative';
        }
      }
      
      // Store successful patterns
      if (effectiveness === 'positive' && finalScore > 70) {
        await this.storeSuccessfulResponse(callData, response, {
          score: finalScore,
          result: effectiveness
        });
      }
      
      // Learn from failures
      if (effectiveness === 'negative') {
        await this.storeFailurePattern(callData, response);
      }
    }
  }

  /**
   * Store failure patterns to avoid
   */
  async storeFailurePattern(callData, response) {
    try {
      const content = `Ineffective response in ${response.phase}: "${response.aiResponse}"
User said: "${response.userMessage}".
Led to decreased engagement.
Context: ${callData.industry} - ${callData.painPoint}`;

      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `failure_pattern_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'failure_pattern',
          phase: response.phase,
          response_text: response.aiResponse,
          user_message: response.userMessage,
          industry: callData.industry,
          timestamp: response.timestamp,
          content: content
        }
      }]);
      
    } catch (error) {
      console.error('Error storing failure pattern:', error);
    }
  }
}

module.exports = AdaptiveResponseGenerator;
