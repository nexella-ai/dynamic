function initConversationHistory(customerName = '') {
  return [
    {
      role: 'system',
      content: \`You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella...

[TRUNCATED for brevity — this is where you paste the system prompt from your original file.]\`
    }
  ];
}

module.exports = { initConversationHistory };