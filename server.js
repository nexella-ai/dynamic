// Complete working server.js with Google Calendar integration
require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');
const GoogleCalendarService = require('./google-calendar-service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Initialize Google Calendar service
const calendarService = new GoogleCalendarService();

// Ensure we have the required environment variables
if (!process.env.TRIGGER_SERVER_URL) {
  process.env.TRIGGER_SERVER_URL = 'https://trigger-server-qt7u.onrender.com';
}
if (!process.env.N8N_WEBHOOK_URL) {
  process.env.N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
}

global.lastTypeformSubmission = null;

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with Google Calendar integration is live!');
});

const activeCallsMetadata = new Map();

function storeContactInfoGlobally(name, email, phone, source = 'Unknown') {
  console.log(`📝 Storing contact info globally from ${source}:`, { name, email, phone });
  
  if (email && email.trim() !== '') {
    global.lastTypeformSubmission = {
      timestamp: new Date().toISOString(),
      email: email.trim(),
      name: (name || '').trim(),
      phone: (phone || '').trim(),
      source: source
    };
    console.log('✅ Stored contact info globally:', global.lastTypeformSubmission);
    return true;
  } else {
    console.warn('⚠️ Cannot store contact info - missing email');
    return false;
  }
}

async function checkAvailability(startTime, endTime) {
  try {
    console.log('🔍 Checking availability via calendar service...');
    const available = await calendarService.isSlotAvailable(startTime, endTime);
    console.log('📊 Calendar service result:', available);
    return available;
  } catch (error) {
    console.error('❌ Error checking availability:', error.message);
    return true;
  }
}

async function getAvailableTimeSlots(date) {
  try {
    console.log('📅 Getting available slots for:', date);
    const availableSlots = await calendarService.getAvailableSlots(date);
    console.log(`📋 Calendar service returned ${availableSlots.length} slots`);
    return availableSlots;
  } catch (error) {
    console.error('❌ Error getting available slots:', error.message);
    return [];
  }
}

function handleSchedulingPreference(userMessage) {
  console.log('🔍 Analyzing user message for scheduling:', userMessage);
  
  const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/i);
  const timeMatch = userMessage.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i) || 
                   userMessage.match(/\b(morning|afternoon|evening|noon)\b/i);
  
  if (dayMatch) {
    const preferredDay = dayMatch[0].toLowerCase();
    let targetDate = new Date();
    
    if (preferredDay === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (preferredDay === 'today') {
      // Keep today's date
    } else {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const requestedDayIndex = daysOfWeek.findIndex(d => d === preferredDay);
      
      if (requestedDayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = requestedDayIndex - currentDay;
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    return {
      dayName: preferredDay,
      date: targetDate,
      isSpecific: true,
      timePreference: timeMatch ? timeMatch[0] : 'morning',
      fullPreference: userMessage
    };
  }
  
  return null;
}

async function sendSchedulingPreference(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    console.log('=== SENDING WEBHOOK ===');
    console.log('Input parameters:', { name, email, phone, preferredDay, callId });
    
    let finalEmail = email;
    let finalName = name;
    let finalPhone = phone;
    
    if (!finalEmail || finalEmail.trim() === '') {
      if (global.lastTypeformSubmission && global.lastTypeformSubmission.email) {
        finalEmail = global.lastTypeformSubmission.email;
      } else if (callId && activeCallsMetadata.has(callId)) {
        const callMetadata = activeCallsMetadata.get(callId);
        if (callMetadata && callMetadata.customer_email) {
          finalEmail = callMetadata.customer_email;
        }
      }
    }
    
    if (!finalEmail || finalEmail.trim() === '') {
      console.error('❌ No email found. Cannot send webhook.');
      return { success: false, error: 'No email address available' };
    }

    const formattedDiscoveryData = {};
    const fieldMappings = {
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry', 
      'question_2': 'Main product',
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
    };
    
    Object.entries(discoveryData).forEach(([key, value]) => {
      if (value && typeof value === 'string' && value.trim() !== '') {
        const trimmedValue = value.trim();
        if (key.startsWith('question_') && fieldMappings[key]) {
          formattedDiscoveryData[fieldMappings[key]] = trimmedValue;
        } else {
          formattedDiscoveryData[key] = trimmedValue;
        }
      }
    });

    const webhookData = {
      name: finalName || '',
      email: finalEmail,
      phone: finalPhone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData,
      calendar_booking: false,
      "How did you hear about us": formattedDiscoveryData["How did you hear about us"] || '',
      "Business/Industry": formattedDiscoveryData["Business/Industry"] || '',
      "Main product": formattedDiscoveryData["Main product"] || '',
      "Running ads": formattedDiscoveryData["Running ads"] || '',
      "Using CRM": formattedDiscoveryData["Using CRM"] || '',
      "Pain points": formattedDiscoveryData["Pain points"] || ''
    };
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Scheduling preference sent successfully');
    return { success: true, data: response.data };

  } catch (error) {
    console.error('❌ Error sending scheduling preference:', error.message);
    return { success: false, error: error.message };
  }
}

app.post('/trigger-retell-call', express.json(), async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    console.log(`Received request to trigger Retell call for ${name} (${email})`);
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    storeContactInfoGlobally(name, email, phone, 'API Call');
    
    const response = await axios.post('https://api.retellai.com/v1/calls', {
      agent_id: process.env.RETELL_AGENT_ID,
      customer_number: phone,
      variables: { customer_name: name || '', customer_email: email },
      metadata: { customer_name: name || '', customer_email: email, customer_phone: phone || '' }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Successfully triggered Retell call: ${response.data.call_id}`);
    res.status(200).json({ 
      success: true, 
      call_id: response.data.call_id,
      message: `Call initiated for ${name || email}`
    });
    
  } catch (error) {
    console.error('Error triggering Retell call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Unknown error triggering call' 
    });
  }
});

wss.on('connection', async (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION ESTABLISHED');
  
  const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
  const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
  
  const connectionData = {
    callId: callId,
    customerEmail: null,
    customerName: null,
    customerPhone: null
  };

  let answerCaptureTimer = null;
  let userResponseBuffer = [];
  let isCapturingAnswer = false;

  const discoveryQuestions = [
    { question: 'How did you hear about us?', field: 'How did you hear about us', asked: false, answered: false, answer: '' },
    { question: 'What industry or business are you in?', field: 'Business/Industry', asked: false, answered: false, answer: '' },
    { question: 'What\'s your main product or service?', field: 'Main product', asked: false, answered: false, answer: '' },
    { question: 'Are you currently running any ads?', field: 'Running ads', asked: false, answered: false, answer: '' },
    { question: 'Are you using any CRM system?', field: 'Using CRM', asked: false, answered: false, answer: '' },
    { question: 'What are your biggest pain points or challenges?', field: 'Pain points', asked: false, answered: false, answer: '' }
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: -1,
    questionsCompleted: 0,
    allQuestionsCompleted: false,
    waitingForAnswer: false
  };

  function detectQuestionAsked(botMessage) {
    const botContent = botMessage.toLowerCase();
    const nextQuestionIndex = discoveryQuestions.findIndex(q => !q.asked);
    
    if (nextQuestionIndex === -1) return false;
    
    const nextQuestion = discoveryQuestions[nextQuestionIndex];
    let detected = false;
    
    switch (nextQuestionIndex) {
      case 0: detected = botContent.includes('hear about'); break;
      case 1: detected = botContent.includes('industry') || botContent.includes('business'); break;
      case 2: detected = botContent.includes('product') || botContent.includes('service'); break;
      case 3: detected = botContent.includes('running') && botContent.includes('ads'); break;
      case 4: detected = botContent.includes('crm'); break;
      case 5: detected = botContent.includes('pain point') || botContent.includes('challenge'); break;
    }
    
    if (detected) {
      nextQuestion.asked = true;
      discoveryProgress.currentQuestionIndex = nextQuestionIndex;
      discoveryProgress.waitingForAnswer = true;
      userResponseBuffer = [];
      return true;
    }
    return false;
  }

  function captureUserAnswer(userMessage) {
    if (!discoveryProgress.waitingForAnswer || isCapturingAnswer) return;
    
    const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
    if (!currentQ || currentQ.answered) return;
    
    userResponseBuffer.push(userMessage.trim());
    
    if (answerCaptureTimer) clearTimeout(answerCaptureTimer);
    
    answerCaptureTimer = setTimeout(() => {
      if (isCapturingAnswer) return;
      isCapturingAnswer = true;
      
      const completeAnswer = userResponseBuffer.join(' ');
      currentQ.answered = true;
      currentQ.answer = completeAnswer;
      discoveryData[currentQ.field] = completeAnswer;
      discoveryData[`question_${discoveryProgress.currentQuestionIndex}`] = completeAnswer;
      
      discoveryProgress.questionsCompleted++;
      discoveryProgress.waitingForAnswer = false;
      discoveryProgress.allQuestionsCompleted = discoveryQuestions.every(q => q.answered);
      
      userResponseBuffer = [];
      isCapturingAnswer = false;
      answerCaptureTimer = null;
    }, 3000);
  }

  let conversationHistory = [{
    role: 'system',
    content: `You are Sarah from Nexella AI. Ask 6 discovery questions in order: 1) How did you hear about us? 2) What industry are you in? 3) What's your main product? 4) Are you running ads? 5) Are you using a CRM? 6) What are your pain points? Only after all 6 questions, ask for scheduling preferences.`
  }];

  let conversationState = 'introduction';
  let bookingInfo = {
    name: connectionData.customerName || '',
    email: connectionData.customerEmail || '',
    phone: connectionData.customerPhone || '',
    preferredDay: ''
  };
  let discoveryData = {};
  let userHasSpoken = false;
  let webhookSent = false;

  ws.send(JSON.stringify({
    content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  ws.on('message', async (data) => {
    try {
      userHasSpoken = true;
      const parsed = JSON.parse(data);
      
      if (parsed.call && parsed.call.metadata) {
        if (!connectionData.customerEmail && parsed.call.metadata.customer_email) {
          connectionData.customerEmail = parsed.call.metadata.customer_email;
          bookingInfo.email = connectionData.customerEmail;
        }
        if (!connectionData.customerName && parsed.call.metadata.customer_name) {
          connectionData.customerName = parsed.call.metadata.customer_name;
          bookingInfo.name = connectionData.customerName;
        }
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        if (conversationHistory.length >= 2) {
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            detectQuestionAsked(lastBotMessage.content);
          }
        }

        if (discoveryProgress.waitingForAnswer && userMessage.trim().length > 2) {
          captureUserAnswer(userMessage);
        }

        let schedulingDetected = false;
        let calendarCheckResponse = '';
        
        if (discoveryProgress.allQuestionsCompleted && 
            userMessage.toLowerCase().match(/\b(schedule|book|monday|tuesday|wednesday|thursday|friday|morning|afternoon)\b/)) {
          
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo && !webhookSent) {
            try {
              let preferredHour = 10;
              if (dayInfo.timePreference) {
                const timeStr = dayInfo.timePreference.toLowerCase();
                if (timeStr.includes('afternoon')) preferredHour = 14;
                if (timeStr.includes('evening')) preferredHour = 16;
              }
              
              const preferredDateTime = new Date(dayInfo.date);
              preferredDateTime.setHours(preferredHour, 0, 0, 0);
              
              const endDateTime = new Date(preferredDateTime);
              endDateTime.setHours(preferredDateTime.getHours() + 1);
              
              const isAvailable = await checkAvailability(
                preferredDateTime.toISOString(), 
                endDateTime.toISOString()
              );
              
              if (isAvailable) {
                bookingInfo.preferredDay = `${dayInfo.dayName} at ${preferredDateTime.toLocaleTimeString('en-US', { 
                  hour: 'numeric', minute: '2-digit', hour12: true 
                })}`;
                schedulingDetected = true;
                calendarCheckResponse = `Perfect! I can book you for ${dayInfo.dayName} at ${preferredDateTime.toLocaleTimeString('en-US', { 
                  hour: 'numeric', minute: '2-digit', hour12: true 
                })}. Let me schedule that right now.`;
              } else {
                const availableSlots = await getAvailableTimeSlots(dayInfo.date);
                if (availableSlots.length > 0) {
                  calendarCheckResponse = `I'm sorry, that time is already booked. I do have ${availableSlots[0].displayTime} available on ${dayInfo.dayName}. Would that work for you?`;
                }
              }
            } catch (calendarError) {
              console.error('❌ Error checking calendar:', calendarError);
              schedulingDetected = true;
              calendarCheckResponse = `Great! Let me schedule you for ${dayInfo.dayName}.`;
            }
          }
        }

        conversationHistory.push({ role: 'user', content: userMessage });

        let contextPrompt = '';
        if (!discoveryProgress.allQuestionsCompleted) {
          const nextUnanswered = discoveryQuestions.find(q => !q.answered);
          if (nextUnanswered) {
            const questionNumber = discoveryQuestions.indexOf(nextUnanswered) + 1;
            contextPrompt = `\n\nAsk question ${questionNumber}: ${nextUnanswered.question}`;
          }
        } else if (calendarCheckResponse) {
          contextPrompt = `\n\nRespond with: "${calendarCheckResponse}"`;
        } else {
          contextPrompt = '\n\nAll questions complete. Ask: "Perfect! What day and time would work best for you?"';
        }

        const messages = [...conversationHistory];
        if (contextPrompt) {
          messages[messages.length - 1].content += contextPrompt;
        }

        const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-4o',
          messages: messages,
          temperature: 0.7
        }, {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        });

        const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me more?";
        conversationHistory.push({ role: 'assistant', content: botReply });

        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
        
        if (schedulingDetected && discoveryProgress.allQuestionsCompleted && !webhookSent) {
          const finalDiscoveryData = {};
          discoveryQuestions.forEach((q, index) => {
            if (q.answered && q.answer) {
              finalDiscoveryData[q.field] = q.answer;
              finalDiscoveryData[`question_${index}`] = q.answer;
            }
          });
          
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
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
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
    if (answerCaptureTimer) clearTimeout(answerCaptureTimer);
    
    if (!webhookSent && connectionData.callId && discoveryProgress.questionsCompleted >= 2) {
      try {
        const finalDiscoveryData = {};
        discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
        await sendSchedulingPreference(
          connectionData.customerName || '',
          connectionData.customerEmail || '',
          connectionData.customerPhone || '',
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          finalDiscoveryData
        );
      } catch (finalError) {
        console.error('❌ Final webhook failed:', finalError.message);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server with Google Calendar integration is listening on port ${PORT}`);
});
