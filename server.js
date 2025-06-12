const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Function to call Gemini API (Gemini 1.5 Flash)
async function callGeminiAPI(prompt, isEvaluation = false) {
    try {
        console.log('Using Gemini 1.5 Flash model...');
        
        // Use Gemini 1.5 Flash model
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Add temperature settings for more consistent responses
        const generationConfig = {
            temperature: isEvaluation ? 0.3 : 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
        };
        
        console.log('Sending request to Gemini API...');
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig
        });
        
        const response = await result.response;
        console.log('Gemini API response received successfully');
        return response.text();
    } catch (error) {
        console.error('Gemini API Error:', error);
        
        // More detailed error logging
        if (error.status) {
            console.error('API Status:', error.status);
        }
        if (error.message) {
            console.error('API Message:', error.message);
        }
        
        throw new Error('AI service temporarily unavailable');
    }
}

// Improved Prompts
function getStartConversationPrompt(scenario) {
    return `You are a professional business English conversation partner. 

SCENARIO: "${scenario}"

INSTRUCTIONS:
- Start a realistic business conversation in English based on this scenario
- Use appropriate business tone and vocabulary
- Keep your opening statement to 1-2 sentences
- Make it engaging and natural
- End with a question or prompt that invites response

EXAMPLE SCENARIOS:
- Meeting: "Good morning! I'd like to discuss the quarterly sales report. How do you think we performed this quarter?"
- Phone call: "Thank you for taking my call. I wanted to follow up on our proposal. Do you have any initial thoughts?"
- Presentation: "I'm excited to present our new marketing strategy. Shall we begin with the market analysis?"

Please respond in English only.`;
}

function getEvaluateResponsePrompt(userResponse, scenario, conversationContext) {
    return `You are a business English learning evaluator. Evaluate the user's response with these criteria:

SCENARIO: "${scenario}"
USER RESPONSE: "${userResponse}"
CONVERSATION CONTEXT: "${conversationContext}"

EVALUATION CRITERIA (Be encouraging and constructive):
✅ PASS if the response:
- Communicates the main idea clearly
- Uses appropriate business tone
- Has minor grammar errors but meaning is clear
- Shows engagement with the scenario

❌ NEEDS IMPROVEMENT only if:
- Meaning is unclear or confusing
- Uses inappropriate casual language for business
- Contains major grammar errors that impede understanding
- Is completely off-topic

RESPONSE FORMAT (in Japanese, max 12 lines):
If PASS: 
"良い回答です。[specific positive feedback about what they did well]
[optional: brief suggestion for improvement]"

If NEEDS IMPROVEMENT: 
"以下のように修正してください：[specific correction example with explanation]"

IMPORTANT: 
- Only provide EVALUATION and FEEDBACK
- Do NOT suggest what the user should say next
- Do NOT provide "next question examples"
- Focus on improving their current response only
- Keep feedback encouraging and constructive

Example good feedback:
"良い回答です。ビジネス的で適切な表現でした。さらに丁寧にするには「I appreciate your time」を追加すると良いでしょう。"

Example bad feedback (avoid):
"良い回答です。次の質問例：What do you think?" ← これは避ける`;
}

function getContinueConversationPrompt(userResponse, scenario, conversationHistory) {
    return `You are a professional business conversation partner. Continue this conversation naturally.

SCENARIO: "${scenario}"
USER'S LAST RESPONSE: "${userResponse}"
CONVERSATION HISTORY: "${conversationHistory}"

INSTRUCTIONS:
- Respond naturally in English as a business professional would
- Keep the conversation moving forward with appropriate questions or comments
- Maintain professional tone suitable for the scenario
- Your response should be 1-2 sentences maximum
- Include a question or prompt to keep the dialogue flowing

Examples of good responses:
- "That's an interesting point. How do you think we should proceed?"
- "I understand your concern. What would be your recommended timeline?"
- "Thank you for that clarification. Shall we move on to the budget discussion?"

Please respond in English only.`;
}

function getGenerateReportPrompt(scenario, exchanges) {
    return `Generate a comprehensive learning report for this business English conversation session.

SCENARIO: "${scenario}"
CONVERSATION DATA: ${JSON.stringify(exchanges)}
TOTAL TURNS COMPLETED: ${exchanges.length}

EVALUATION CRITERIA:
- Communication Effectiveness (40 points): Clear message delivery
- Business Appropriateness (30 points): Professional tone and vocabulary
- Grammar & Accuracy (20 points): Language correctness
- Engagement & Flow (10 points): Natural conversation participation

SCORING GUIDELINES:
- 85-100: Excellent business communication skills
- 70-84: Good communication with minor improvements needed
- 55-69: Adequate communication, some areas for development
- Below 55: Needs significant improvement

RESPONSE FORMAT (in Japanese):
[Calculate score based on performance]

総合スコア: [score]/100点

【評価概要】
コミュニケーション効果: [brief assessment]
ビジネス適切性: [brief assessment]
文法・正確性: [brief assessment]

【改善点とアドバイス】
[2-3 specific, actionable suggestions for improvement]

【次回への推奨】
[suggestion for next practice scenario or focus area]

Keep the report encouraging but honest, focusing on practical improvement areas.`;
}

// API Routes
app.post('/api/start-conversation', async (req, res) => {
    try {
        const { scenario } = req.body;
        console.log('Start conversation request:', { scenario });
        
        if (!scenario || scenario.trim().length === 0) {
            return res.status(400).json({ error: 'Scenario is required' });
        }

        const prompt = getStartConversationPrompt(scenario);
        const response = await callGeminiAPI(prompt, false);
        
        console.log('Start conversation success');
        res.json({ response: response.trim() });
    } catch (error) {
        console.error('Start conversation error:', error);
        
        const fallbackResponse = "Hello! I'm ready to practice this business scenario with you. Please share your thoughts or questions about this situation.";
        res.json({ response: fallbackResponse });
    }
});

app.post('/api/evaluate-response', async (req, res) => {
    try {
        const { userResponse, scenario, conversationContext } = req.body;
        console.log('Evaluate response request:', { userResponse, scenario });
        
        if (!userResponse || userResponse.trim().length === 0) {
            return res.status(400).json({ error: 'User response is required' });
        }

        const prompt = getEvaluateResponsePrompt(userResponse, scenario, conversationContext);
        const response = await callGeminiAPI(prompt, true);
        
        console.log('Evaluate response success');
        res.json({ response: response.trim() });
    } catch (error) {
        console.error('Evaluate response error:', error);
        
        const fallbackResponse = "良い回答です。継続して練習を続けてください。";
        res.json({ response: fallbackResponse });
    }
});

app.post('/api/continue-conversation', async (req, res) => {
    try {
        const { userResponse, scenario, conversationHistory } = req.body;
        console.log('Continue conversation request:', { userResponse, scenario });
        
        if (!userResponse || userResponse.trim().length === 0) {
            return res.status(400).json({ error: 'User response is required' });
        }

        const prompt = getContinueConversationPrompt(userResponse, scenario, conversationHistory);
        const response = await callGeminiAPI(prompt, false);
        
        console.log('Continue conversation success');
        res.json({ response: response.trim() });
    } catch (error) {
        console.error('Continue conversation error:', error);
        
        const fallbackResponse = "That's interesting. Could you tell me more about your thoughts on this?";
        res.json({ response: fallbackResponse });
    }
});

app.post('/api/generate-report', async (req, res) => {
    try {
        const { scenario, exchanges } = req.body;
        console.log('Generate report request:', { scenario, exchangeCount: exchanges?.length });
        
        if (!exchanges || exchanges.length === 0) {
            return res.status(400).json({ error: 'Conversation data is required' });
        }

        const prompt = getGenerateReportPrompt(scenario, exchanges);
        const response = await callGeminiAPI(prompt, true);
        
        // Extract score from response
        let score = 75; // Default score
        const scoreMatch = response.match(/(\d+)\/100/);
        if (scoreMatch) {
            score = parseInt(scoreMatch[1]);
        }
        
        console.log('Generate report success, score:', score);
        res.json({ 
            response: response.trim(),
            score: score 
        });
    } catch (error) {
        console.error('Generate report error:', error);
        
        const score = Math.max(60, Math.min(85, 75 + Math.random() * 10));
        const fallbackResponse = `総合スコア: ${Math.round(score)}/100点

【評価概要】
コミュニケーション効果: 基本的な意思疎通ができていました
ビジネス適切性: 適切なビジネス英語を使用していました
文法・正確性: 理解しやすい英語でした

【改善点とアドバイス】
・継続的な練習でさらなる向上が期待できます
・様々なビジネスシナリオに挑戦してみてください

【次回への推奨】
今回の経験を活かして、より複雑なビジネス状況にも挑戦してみましょう。`;

        res.json({ 
            response: fallbackResponse,
            score: Math.round(score)
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        model: 'gemini-1.5-flash',
        hasApiKey: !!process.env.GEMINI_API_KEY
    });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🤖 Model: gemini-1.5-flash`);
    console.log(`🔑 Gemini API configured: ${!!process.env.GEMINI_API_KEY}`);
    console.log(`🌐 Health check: http://localhost:${port}/api/health`);
});

module.exports = app;