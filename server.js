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

// Password verification middleware
const VALID_PASSWORD = "2025_July";

function verifyPassword(req, res, next) {
    const { password } = req.body;
    
    // Allow health check without password
    if (req.path === '/api/health') {
        return next();
    }
    
    if (!password || password !== VALID_PASSWORD) {
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Valid password required' 
        });
    }
    
    next();
}

// Apply password verification to API routes
app.use('/api', (req, res, next) => {
    if (req.path === '/health') {
        return next();
    }
    verifyPassword(req, res, next);
});

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

function getEvaluateResponsePrompt(userResponse, scenario, conversationContext, difficulty = 'normal') {
    const basePrompt = `You are a business English learning evaluator. Evaluate the user's response with these criteria:

SCENARIO: "${scenario}"
USER RESPONSE: "${userResponse}"
CONVERSATION CONTEXT: "${conversationContext}"
DIFFICULTY LEVEL: "${difficulty.toUpperCase()}"`;

    const normalCriteria = `
EVALUATION CRITERIA (NORMAL MODE - Be encouraging and constructive):
✅ PASS if the response:
- Communicates the main idea clearly
- Uses appropriate business tone
- Has minor grammar errors but meaning is clear
- Shows engagement with the scenario

❌ NEEDS IMPROVEMENT only if:
- Meaning is unclear or confusing
- Uses inappropriate casual language for business
- Contains major grammar errors that impede understanding
- Is completely off-topic`;

    const hardCriteria = `
EVALUATION CRITERIA (HARD MODE - Higher standards for accuracy):
✅ PASS if the response:
- Communicates the main idea clearly with precise vocabulary
- Uses sophisticated business expressions and tone
- Has minimal or no grammar errors
- Shows deep engagement and understanding of the scenario
- Demonstrates advanced language skills

❌ NEEDS IMPROVEMENT if:
- Has noticeable grammar mistakes
- Uses basic or inappropriate vocabulary for the business context
- Lacks sophistication in expression
- Missing key business communication elements
- Could be more professional or polished`;

    const criteria = difficulty === 'hard' ? hardCriteria : normalCriteria;

    const feedbackExample = difficulty === 'hard' ? 
        '"良い回答です。高度なビジネス表現を使用しており、文法も正確でした。さらに洗練させるには「I would be delighted to」のような丁寧な表現を検討してください。"' :
        '"良い回答です。ビジネス的で適切な表現でした。さらに丁寧にするには「I appreciate your time」を追加すると良いでしょう。"';

    return basePrompt + criteria + `

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
- Adjust strictness based on difficulty level

Example good feedback for ${difficulty} mode:
${feedbackExample}`;
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

function getGenerateReportPrompt(scenario, exchanges, difficulty = 'normal') {
    const scoringGuidelines = difficulty === 'hard' ? `
- 90-100: Exceptional business communication with sophisticated language
- 80-89: Very good communication with minor areas for refinement
- 70-79: Good communication but needs more advanced expressions
- 60-69: Adequate communication, significant room for improvement
- Below 60: Needs substantial work on accuracy and sophistication` : `
- 85-100: Excellent business communication skills
- 70-84: Good communication with minor improvements needed
- 55-69: Adequate communication, some areas for development
- Below 55: Needs significant improvement`;

    const improvementLabel = difficulty === 'hard' ? 'より高度な' : '';

    return `Generate a comprehensive learning report for this business English conversation session.

SCENARIO: "${scenario}"
DIFFICULTY LEVEL: "${difficulty.toUpperCase()}"
CONVERSATION DATA: ${JSON.stringify(exchanges)}
TOTAL TURNS COMPLETED: ${exchanges.length}

EVALUATION CRITERIA (adjusted for ${difficulty} mode):
- Communication Effectiveness (40 points): Clear message delivery
- Business Appropriateness (30 points): Professional tone and vocabulary
- Grammar & Accuracy (20 points): Language correctness ${difficulty === 'hard' ? '(stricter standards)' : '(lenient standards)'}
- Engagement & Flow (10 points): Natural conversation participation

SCORING GUIDELINES for ${difficulty.toUpperCase()} mode:
${scoringGuidelines}

RESPONSE FORMAT (in Japanese):
[Calculate score based on performance and difficulty level]

総合スコア: [score]/100点 (${difficulty === 'hard' ? 'ハードモード' : 'ノーマルモード'})

【評価概要】
コミュニケーション効果: [brief assessment]
ビジネス適切性: [brief assessment]
文法・正確性: [brief assessment]

【${improvementLabel}改善点とアドバイス】
[2-3 specific, actionable suggestions for improvement appropriate for difficulty level]

【次回への推奨】
[suggestion for next practice scenario or focus area, considering current difficulty level]

Keep the report encouraging but honest, focusing on practical improvement areas appropriate for the selected difficulty level.`;
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
        const { userResponse, scenario, conversationContext, difficulty = 'normal' } = req.body;
        console.log('Evaluate response request:', { userResponse, scenario, difficulty });
        
        if (!userResponse || userResponse.trim().length === 0) {
            return res.status(400).json({ error: 'User response is required' });
        }

        const prompt = getEvaluateResponsePrompt(userResponse, scenario, conversationContext, difficulty);
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
        const { scenario, exchanges, difficulty = 'normal' } = req.body;
        console.log('Generate report request:', { scenario, exchangeCount: exchanges?.length, difficulty });
        
        if (!exchanges || exchanges.length === 0) {
            return res.status(400).json({ error: 'Conversation data is required' });
        }

        const prompt = getGenerateReportPrompt(scenario, exchanges, difficulty);
        const response = await callGeminiAPI(prompt, true);
        
        // Extract score from response
        let score = difficulty === 'hard' ? 70 : 75; // Different default scores
        const scoreMatch = response.match(/(\d+)\/100/);
        if (scoreMatch) {
            score = parseInt(scoreMatch[1]);
        }
        
        console.log('Generate report success, score:', score, 'difficulty:', difficulty);
        res.json({ 
            response: response.trim(),
            score: score 
        });
    } catch (error) {
        console.error('Generate report error:', error);
        
        // Adjusted fallback scores based on difficulty
        const baseScore = difficulty === 'hard' ? 65 : 75;
        const score = Math.max(50, Math.min(90, baseScore + Math.random() * 10));
        const difficultyText = difficulty === 'hard' ? 'ハードモード' : 'ノーマルモード';
        
        const additionalAdvice = difficulty === 'hard' ? '\n・より高度な表現や語彙の習得を目指しましょう' : '';
        
        const fallbackResponse = `総合スコア: ${Math.round(score)}/100点 (${difficultyText})

【評価概要】
コミュニケーション効果: 基本的な意思疎通ができていました
ビジネス適切性: 適切なビジネス英語を使用していました
文法・正確性: 理解しやすい英語でした

【改善点とアドバイス】
・継続的な練習でさらなる向上が期待できます
・様々なビジネスシナリオに挑戦してみてください${additionalAdvice}

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
        hasApiKey: !!process.env.GEMINI_API_KEY,
        passwordProtected: true
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
    console.log(`🔐 Password protection: enabled`);
    console.log(`🌐 Health check: http://localhost:${port}/api/health`);
});

module.exports = app;