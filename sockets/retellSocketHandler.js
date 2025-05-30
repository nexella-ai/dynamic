async function handleWebSocketConnection(ws, req) {
console.log('🔗 NEW WEBSOCKET CONNECTION ESTABLISHED');
  console.log('Connection URL:', req.url);
  
  // Extract call ID from URL
  const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
  const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
  
  console.log('📞 Extracted Call ID:', callId);
  
  // Store connection data with this WebSocket
  const connectionData = {
    callId: callId,
    metadata: null,
    customerEmail: null,
    customerName: null,
    customerPhone: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };

  // Try to fetch call metadata but don't block if it fails
  if (callId) {
    try {
      console.log('🔍 Fetching metadata for call:', callId);
      const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
      
      // Try multiple possible endpoints
      const possibleEndpoints = [
        `${TRIGGER_SERVER_URL}/api/get-call-data/${callId}`,
        `${TRIGGER_SERVER_URL}/get-call-info/${callId}`,
        `${TRIGGER_SERVER_URL}/call-data/${callId}`,
        `${TRIGGER_SERVER_URL}/api/call/${callId}`
      ];
      
      let metadataFetched = false;
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying endpoint: ${endpoint}`);
          const response = await fetch(endpoint, { 
            timeout: 3000,
            headers: {
              'Content-Type': 'application/json'
            }
          });
          if (response.ok) {
            const callData = await response.json();
            console.log('📋 Retrieved call metadata:', callData);
            
            // Handle nested response structure
            const actualData = callData.data || callData;
            connectionData.metadata = actualData;
            
            // Extract data from metadata - handle both direct and nested structure
            connectionData.customerEmail = actualData.email || actualData.customer_email || actualData.user_email || 
                                         (actualData.metadata && actualData.metadata.customer_email);
            connectionData.customerName = actualData.name || actualData.customer_name || actualData.user_name ||
                                        (actualData.metadata && actualData.metadata.customer_name);
            connectionData.customerPhone = actualData.phone || actualData.customer_phone || actualData.to_number ||
                                         (actualData.metadata && actualData.metadata.customer_phone);
            
            console.log('📧 Extracted from metadata:', {
              email: connectionData.customerEmail,
              name: connectionData.customerName,
              phone: connectionData.customerPhone
            });
            
            // Check if this is an appointment confirmation call
            if (callData.call_type === 'appointment_confirmation') {
              connectionData.isAppointmentConfirmation = true;
              console.log('📅 This is an APPOINTMENT CONFIRMATION call');
            }
            
            metadataFetched = true;
            break;
          }
        } catch (endpointError) {
          console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
        }
      }
      
      if (!metadataFetched) {
        console.log('⚠️ Could not fetch metadata from any endpoint - will try to get from WebSocket messages');
      }
      
    } catch (error) {
      console.log('❌ Error fetching call metadata:', error.message);
      console.log('🔄 Will extract data from WebSocket messages instead');
    }
  }
  
  console.log('Retell connected via WebSocket.');
  
  // FIXED: Discovery questions system with proper tracking
  const discoveryQuestions = [
    {
      question: 'How did you hear about us?',
      field: 'How did you hear about us',
      keywords: ['hear about', 'find us', 'found us', 'discover us', 'learn about'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'What industry or business are you in?',
      field: 'Business/Industry',
      keywords: ['industry', 'business', 'line of business', 'company', 'what do you do', 'work in'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'What\'s your main product or service?',
      field: 'Main product',
      keywords: ['main product', 'product', 'service', 'sell', 'offer', 'provide'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'Are you currently running any ads?',
      field: 'Running ads',
      keywords: ['ads', 'advertising', 'marketing', 'running ads', 'meta', 'google', 'facebook'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'Are you using any CRM system?',
      field: 'Using CRM',
      keywords: ['crm', 'gohighlevel', 'management system', 'customer relationship', 'software'],
      asked: false,
      answered: false,
      answer: ''
    },
    {
      question: 'What are your biggest pain points or challenges?',
      field: 'Pain points',
      keywords: ['pain points', 'problems', 'challenges', 'issues', 'difficulties', 'struggling', 'biggest challenge', 'pain point'],
      asked: false,
      answered: false,
      answer: ''
    }
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: 0,
    questionsCompleted: 0,
    allQuestionsCompleted: false,
    lastBotMessage: '',
    waitingForAnswer: false,
    questionOrder: [] // Track the order questions were asked
  };

  // UPDATED: Improved system prompt with better greeting flow
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella.

CONVERSATION FLOW:
1. GREETING PHASE: Start with a warm greeting and ask how they're doing
2. BRIEF CHAT: Engage in 1-2 exchanges of pleasantries before discovery
3. TRANSITION: Naturally transition to discovery questions
4. DISCOVERY PHASE: Ask all 6 discovery questions systematically
5. SCHEDULING PHASE: Only after all 6 questions are complete

GREETING & TRANSITION GUIDELINES:
- Always start with: "Hi there! This is Sarah from Nexella AI. How are you doing today?"
- When they respond to how they're doing, acknowledge it warmly
- After 1-2 friendly exchanges, transition naturally with something like:
  "That's great to hear! I'd love to learn a bit more about you and your business so I can better help you today."
- Then start with the first discovery question

CRITICAL DISCOVERY REQUIREMENTS:
- You MUST ask ALL 6 discovery questions in the exact order listed below
- Ask ONE question at a time and wait for the customer's response
- Do NOT move to scheduling until ALL 6 questions are answered
- After each answer, acknowledge it briefly before asking the next question

DISCOVERY QUESTIONS (ask in this EXACT order):
1. "How did you hear about us?"
2. "What industry or business are you in?"
3. "What's your main product or service?"
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

SPEAKING STYLE & PACING:
- Speak at a SLOW, measured pace - never rush your words
- Insert natural pauses between sentences using periods (.)
- Complete all your sentences fully - never cut off mid-thought
- Use shorter sentences rather than long, complex ones
- Keep your statements and questions concise but complete

PERSONALITY & TONE:
- Be warm and friendly but speak in a calm, measured way
- Use a consistent, even speaking tone throughout the conversation
- Use contractions and everyday language that sounds natural
- Maintain a calm, professional demeanor at all times
- If you ask a question with a question mark '?' go up in pitch and tone towards the end of the sentence.
- If you respond with "." always keep an even consistent tone towards the end of the sentence.

DISCOVERY FLOW:
- Only start discovery questions AFTER greeting exchange is complete
- After each answer, say something like "That's great, thank you for sharing that."
- Then immediately ask the next question
- Do NOT skip questions or assume answers
- Count your questions mentally: 1, 2, 3, 4, 5, 6

SCHEDULING APPROACH:
- ONLY after asking ALL 6 discovery questions, ask for scheduling preference
- Say: "Perfect! I have all the information I need. Let's schedule a call to discuss how we can help. What day would work best for you?"
- When they mention a day, acknowledge it and confirm scheduling

Remember: Start with greeting, have brief pleasant conversation, then systematically complete ALL 6 discovery questions before any scheduling discussion.`
    }
  ];

  // States for conversation flow
  let conversationState = 'introduction';
  let bookingInfo = {
    name: connectionData.customerName || '',
    email: connectionData.customerEmail || '',
    phone: connectionData.customerPhone || '',
    preferredDay: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let discoveryData = {}; // This will store the final answers
  let collectedContactInfo = !!connectionData.customerEmail;
  let userHasSpoken = false;
  let webhookSent = false;

  // Send connecting message
  ws.send(JSON.stringify({
    content: "Hi there",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  // Send auto-greeting after a short delay
  setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending auto-greeting message');
      ws.send(JSON.stringify({
        content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 2000); // Reduced to 2 seconds for faster response

  // Set a timer for auto-greeting if user doesn't speak first
  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending backup auto-greeting');
      ws.send(JSON.stringify({
        content: "Hello! This is Sarah from Nexella AI. I'm here to help you today. How's everything going?",
        content_complete: true,
        actions: [],
        response_id: 2
      }));
    }
  }, 5000); // 5 seconds delay as backup

  // ENHANCED: Message handling with better discovery tracking
  ws.on('message', async (data) => {
    try {
      clearTimeout(autoGreetingTimer);
      userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      console.log('📥 Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      // Debug logging to see what we're receiving
      console.log('WebSocket message type:', parsed.interaction_type || 'unknown');
      if (parsed.call) {
        console.log('Call data structure:', JSON.stringify(parsed.call, null, 2));
      }
      
      // Extract call info from WebSocket messages first
      if (parsed.call && parsed.call.call_id) {
        if (!connectionData.callId) {
          connectionData.callId = parsed.call.call_id;
          console.log(`🔗 Got call ID from WebSocket: ${connectionData.callId}`);
        }
        
        // Extract metadata from call object
        if (parsed.call.metadata) {
          console.log('📞 Call metadata from WebSocket:', JSON.stringify(parsed.call.metadata, null, 2));
          
          if (!connectionData.customerEmail && parsed.call.metadata.customer_email) {
            connectionData.customerEmail = parsed.call.metadata.customer_email;
            bookingInfo.email = connectionData.customerEmail;
            console.log(`✅ Got email from WebSocket metadata: ${connectionData.customerEmail}`);
          }
          
          if (!connectionData.customerName && parsed.call.metadata.customer_name) {
            connectionData.customerName = parsed.call.metadata.customer_name;
            bookingInfo.name = connectionData.customerName;
            console.log(`✅ Got name from WebSocket metadata: ${connectionData.customerName}`);
          }
          
          if (!connectionData.customerPhone && (parsed.call.metadata.customer_phone || parsed.call.to_number)) {
            connectionData.customerPhone = parsed.call.metadata.customer_phone || parsed.call.to_number;
            bookingInfo.phone = connectionData.customerPhone;
            console.log(`✅ Got phone from WebSocket metadata: ${connectionData.customerPhone}`);
          }
        }
        
        // Extract phone from call object if not in metadata
        if (!connectionData.customerPhone && parsed.call.to_number) {
          connectionData.customerPhone = parsed.call.to_number;
          bookingInfo.phone = connectionData.customerPhone;
          console.log(`✅ Got phone from call object: ${connectionData.customerPhone}`);
        }
        
        // Store in active calls metadata map
        activeCallsMetadata.set(connectionData.callId, {
          customer_email: connectionData.customerEmail,
          customer_name: connectionData.customerName,
          phone: connectionData.customerPhone,
          to_number: connectionData.customerPhone
        });
        
        collectedContactInfo = !!connectionData.customerEmail;
      }
      
      // ENHANCED: Get contact info when we connect to a call (BACKUP METHOD)
      if (parsed.call && parsed.call.call_id && !collectedContactInfo) {
        // FIRST: Try to get contact info from trigger server using call_id
        try {
          console.log('📞 Fetching contact info from trigger server...');
          const triggerResponse = await axios.get(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/get-call-info/${connectionData.callId}`, {
            timeout: 5000
          });
          
          if (triggerResponse.data && triggerResponse.data.success) {
            const callInfo = triggerResponse.data.data;
            if (!bookingInfo.email) bookingInfo.email = callInfo.email || '';
            if (!bookingInfo.name) bookingInfo.name = callInfo.name || '';
            if (!bookingInfo.phone) bookingInfo.phone = callInfo.phone || '';
            collectedContactInfo = true;
            
            console.log('✅ Got contact info from trigger server:', {
              name: bookingInfo.name,
              email: bookingInfo.email,
              phone: bookingInfo.phone
            });
            
            // Update system prompt with the actual customer name if we have it
            if (bookingInfo.name) {
              const systemPrompt = conversationHistory[0].content;
              conversationHistory[0].content = systemPrompt
                .replace(/\[Name\]/g, bookingInfo.name)
                .replace(/Monica/g, bookingInfo.name);
              console.log(`Updated system prompt with customer name: ${bookingInfo.name}`);
            }
          }
        } catch (triggerError) {
          console.log('⚠️ Could not fetch contact info from trigger server:', triggerError.message);
        }
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('🗣️ User said:', userMessage);
        console.log('🔄 Current conversation state:', conversationState);
        console.log('📊 Discovery progress:', discoveryProgress);

        // FIXED: Better discovery question tracking (keeping original working logic)
        if (conversationHistory.length >= 2) {
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            const botContent = lastBotMessage.content.toLowerCase();
            discoveryProgress.lastBotMessage = botContent;
            
            // Check if bot asked ANY discovery question that hasn't been asked yet
            discoveryQuestions.forEach((q, index) => {
              if (!q.asked) {
                // Enhanced keyword matching - especially for CRM and pain points
                let keywordMatch = false;
                if (index === 0) { // How did you hear about us
                  keywordMatch = q.keywords.some(keyword => botContent.includes(keyword));
                } else if (index === 4) { // CRM question (index 4)
                  keywordMatch = botContent.includes('crm') || 
                                botContent.includes('customer relationship') ||
                                botContent.includes('management system') ||
                                botContent.includes('using any') ||
                                botContent.includes('system');
                } else if (index === 5) { // Pain points question (index 5)
                  keywordMatch = botContent.includes('pain point') || 
                                botContent.includes('challenge') || 
                                botContent.includes('problem') || 
                                botContent.includes('difficult') ||
                                botContent.includes('struggle') ||
                                botContent.includes('biggest') ||
                                botContent.includes('issue');
                } else {
                  keywordMatch = q.keywords.some(keyword => botContent.includes(keyword));
                }
                
                if (keywordMatch) {
                  console.log(`✅ DETECTED: Question ${index + 1} was asked: "${q.question}"`);
                  q.asked = true;
                  discoveryProgress.waitingForAnswer = true;
                  discoveryProgress.currentQuestionIndex = index;
                  discoveryProgress.questionOrder.push(index);
                }
              }
            });
            
            // If we were waiting for an answer and user responded, capture it
            if (discoveryProgress.waitingForAnswer && userMessage.trim().length > 2) {
              const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
              if (currentQ && currentQ.asked && !currentQ.answered) {
                currentQ.answered = true;
                currentQ.answer = userMessage.trim();
                discoveryData[currentQ.field] = userMessage.trim();
                discoveryData[`question_${discoveryProgress.currentQuestionIndex}`] = userMessage.trim();
                
                discoveryProgress.questionsCompleted++;
                discoveryProgress.waitingForAnswer = false;
                
                console.log(`✅ CAPTURED ANSWER ${discoveryProgress.questionsCompleted}/6:`);
                console.log(`   Question: ${currentQ.question}`);
                console.log(`   Answer: "${userMessage.trim()}"`);
                console.log(`   Field: ${currentQ.field}`);
                
                // Debug: Show which questions are still unanswered
                const unanswered = discoveryQuestions.filter(q => !q.answered);
                console.log(`📋 Remaining questions: ${unanswered.length}`);
                unanswered.forEach((q, i) => {
                  console.log(`   ${i + 1}. ${q.question} (asked: ${q.asked})`);
                });
              }
            }
          }
        }

        // FIXED: More accurate completion check
        discoveryProgress.allQuestionsCompleted = discoveryQuestions.every(q => q.answered);
        
        console.log(`📊 Discovery Status: ${discoveryProgress.questionsCompleted}/6 questions completed`);
        console.log(`📊 All questions completed: ${discoveryProgress.allQuestionsCompleted}`);
        console.log('📋 Current discovery data:', JSON.stringify(discoveryData, null, 2));

        // Check for scheduling preference (only after ALL questions are answered)
        let schedulingDetected = false;
        if (discoveryProgress.allQuestionsCompleted && 
            userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/)) {
          
          console.log('🗓️ User mentioned scheduling after completing ALL discovery questions');
          
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo && !webhookSent) {
            bookingInfo.preferredDay = dayInfo.dayName;
            schedulingDetected = true;
          }
        } else if (!discoveryProgress.allQuestionsCompleted && 
                   userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
          console.log('⚠️ User mentioned scheduling but discovery is not complete. Continuing with questions.');
        }

        // Add user message to conversation history
        conversationHistory.push({ role: 'user', content: userMessage });

        // ENHANCED: Better context for GPT about current question status (keeping original approach)
        let contextPrompt = '';
        if (!discoveryProgress.allQuestionsCompleted) {
          const nextUnanswered = discoveryQuestions.find(q => !q.answered);
          if (nextUnanswered) {
            const questionNumber = discoveryQuestions.indexOf(nextUnanswered) + 1;
            contextPrompt = `\n\nIMPORTANT: You need to ask question ${questionNumber}: "${nextUnanswered.question}". You have completed ${discoveryProgress.questionsCompleted} out of 6 questions so far. Do NOT skip to scheduling until all 6 questions are answered.`;
          }
        } else {
          contextPrompt = '\n\nAll 6 discovery questions have been completed. You can now proceed to scheduling.';
        }

        // Process with GPT
        const messages = [...conversationHistory];
        if (contextPrompt) {
          messages[messages.length - 1].content += contextPrompt;
        }

        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: messages,
            temperature: 0.7
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 8000
          }
        );

        const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me a bit more about that?";

        // Add bot reply to conversation history (without context prompt)
        conversationHistory.push({ role: 'assistant', content: botReply });

        // Update conversation state
        if (conversationState === 'introduction') {
          conversationState = 'discovery';
        } else if (conversationState === 'discovery' && discoveryProgress.allQuestionsCompleted) {
          conversationState = 'booking';
          console.log('🔄 Transitioning to booking state - ALL 6 discovery questions completed');
        }

        // Send the AI response
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
        // FIXED: Enhanced webhook sending logic
        if (schedulingDetected && discoveryProgress.allQuestionsCompleted && !webhookSent) {
          console.log('🚀 SENDING WEBHOOK - All conditions met:');
          console.log('   ✅ All 6 discovery questions completed and answered');
          console.log('   ✅ Scheduling preference detected');
          console.log('   ✅ Contact info available');
          
          // Final validation of discovery data
          const finalDiscoveryData = {};
          discoveryQuestions.forEach((q, index) => {
            if (q.answered && q.answer) {
              finalDiscoveryData[q.field] = q.answer;
              finalDiscoveryData[`question_${index}`] = q.answer;
            }
          });
          
          console.log('📋 Final discovery data being sent:', JSON.stringify(finalDiscoveryData, null, 2));
          
          const result = await sendSchedulingPreference(
            bookingInfo.name || connectionData.customerName || '',
            bookingInfo.email || connectionData.customerEmail || '',
            bookingInfo.phone || connectionData.customerPhone || '',
            bookingInfo.preferredDay,
            connectionData.callId,
            finalDiscoveryData
          );
          
          if (result.success) {
            webhookSent = true;
            conversationState = 'completed';
            console.log('✅ Webhook sent successfully with all discovery data');
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      
      // Enhanced emergency webhook logic
      if (!webhookSent && connectionData.callId && 
          (bookingInfo.email || connectionData.customerEmail) &&
          discoveryProgress.questionsCompleted >= 4) { // Reduced threshold but still substantial
        try {
          console.log('🚨 EMERGENCY WEBHOOK SEND - Substantial discovery data available');
          
          // Create emergency discovery data from what we have
          const emergencyDiscoveryData = {};
          discoveryQuestions.forEach((q, index) => {
            if (q.answered && q.answer) {
              emergencyDiscoveryData[q.field] = q.answer;
              emergencyDiscoveryData[`question_${index}`] = q.answer;
            }
          });
          
          await sendSchedulingPreference(
            bookingInfo.name || connectionData.customerName || '',
            bookingInfo.email || connectionData.customerEmail || '',
            bookingInfo.phone || connectionData.customerPhone || '',
            bookingInfo.preferredDay || 'Error occurred',
            connectionData.callId,
            emergencyDiscoveryData
          );
          webhookSent = true;
          console.log('✅ Emergency webhook sent with available discovery data');
        } catch (webhookError) {
          console.error('❌ Emergency webhook also failed:', webhookError.message);
        }
      }
      
      // Send a recovery message
      ws.send(JSON.stringify({
        content: "I missed that. Could you repeat it?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });

  ws.on('close', async () => {
    console.log('🔌 Connection closed.');
    clearTimeout(autoGreetingTimer);
    
    console.log('=== FINAL CONNECTION CLOSE ANALYSIS ===');
    console.log('📋 Final discoveryData:', JSON.stringify(discoveryData, null, 2));
    console.log('📊 Questions completed:', discoveryProgress.questionsCompleted);
    console.log('📊 All questions completed:', discoveryProgress.allQuestionsCompleted);
    
    // Detailed breakdown of each question
    discoveryQuestions.forEach((q, index) => {
      console.log(`Question ${index + 1}: Asked=${q.asked}, Answered=${q.answered}, Answer="${q.answer}"`);
    });
    
    // FINAL webhook attempt only if we have meaningful data and haven't sent yet
    if (!webhookSent && connectionData.callId && discoveryProgress.questionsCompleted >= 2) {
      try {
        const finalEmail = connectionData.customerEmail || bookingInfo.email || '';
        const finalName = connectionData.customerName || bookingInfo.name || '';
        const finalPhone = connectionData.customerPhone || bookingInfo.phone || '';
        
        console.log('🚨 FINAL WEBHOOK ATTEMPT on connection close');
        console.log(`📊 Sending with ${discoveryProgress.questionsCompleted}/6 questions completed`);
        
        // Create final discovery data from answered questions
        const finalDiscoveryData = {};
        discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
        await sendSchedulingPreference(
          finalName,
          finalEmail,
          finalPhone,
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          finalDiscoveryData
        );
        
        console.log('✅ Final webhook sent successfully on connection close');
        webhookSent = true;
      } catch (finalError) {
        console.error('❌ Final webhook failed:', finalError.message);
      }
    }
    
    // Clean up
    if (connectionData.callId) {
      activeCallsMetadata.delete(connectionData.callId);
      console.log(`🧹 Cleaned up metadata for call ${connectionData.callId}`);
    }
  });
}

module.exports = { handleWebSocketConnection };