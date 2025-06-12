require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log(`Starting server on port: ${PORT}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

// Helper function to call Gemini API
async function callGeminiAPI(prompt, isJapanese = false) {
    try {
        const requestBody = {
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        };

        const response = await axios.post(
            `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000
            }
        );

        if (response.data && response.data.candidates && response.data.candidates[0]) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Invalid response from Gemini API');
        }
    } catch (error) {
        console.error('Gemini API Error:', error.response?.data || error.message);
        throw new Error('Failed to get response from AI');
    }
}

// API Routes
app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, isJapanese } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Gemini API key not configured' });
        }

        const response = await callGeminiAPI(prompt, isJapanese);
        res.json({ response });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for starting conversation
app.post('/api/start-conversation', async (req, res) => {
    try {
        const { scenario } = req.body;
        
        const prompt = `You are an AI English conversation partner for business English practice. The user wants to practice English in this scenario: "${scenario}". 

Please start the conversation naturally in English. Keep your response:
- Professional and business-appropriate
- Conversational and engaging
- Around 1-2 sentences
- Encouraging the user to respond

Start the conversation now.`;

        const response = await callGeminiAPI(prompt);
        res.json({ response });
    } catch (error) {
        console.error('Start conversation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for evaluating user response
app.post('/api/evaluate-response', async (req, res) => {
    try {
        const { userResponse, scenario, conversationContext } = req.body;
        
        const prompt = `あなたは英語学習の評価者です。以下の英語回答を評価してください：

シナリオ: "${scenario}"
ユーザーの回答: "${userResponse}"
会話の文脈: "${conversationContext}"

以下の基準で評価し、日本語で回答してください：

1. 文法的に正しく、自然な表現の場合：
   - "良い回答です。" と言って、会話を続けるための英語の質問や応答を提供してください。

2. 改善が必要な場合：
   - 具体的な問題点を指摘
   - 正しい表現を提示
   - 「以下のように修正して再度お答えください：」で始まる修正例を提供

評価を開始してください。`;

        const response = await callGeminiAPI(prompt, true);
        res.json({ response });
    } catch (error) {
        console.error('Evaluate response error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for continuing conversation
app.post('/api/continue-conversation', async (req, res) => {
    try {
        const { userResponse, scenario, conversationHistory } = req.body;
        
        const prompt = `Continue this English conversation naturally. 

Scenario: "${scenario}"
User just said: "${userResponse}"
Previous conversation: ${conversationHistory}

Please respond in English:
- Keep it professional and business-appropriate
- Make it conversational and engaging
- Ask a follow-up question or make a relevant comment
- Keep response to 1-2 sentences
- Stay within the context of the scenario`;

        const response = await callGeminiAPI(prompt);
        res.json({ response });
    } catch (error) {
        console.error('Continue conversation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for generating final report
app.post('/api/generate-report', async (req, res) => {
    try {
        const { scenario, exchanges } = req.body;
        
        const prompt = `以下の英語会話練習セッションを総合的に評価し、詳細なレポートを日本語で作成してください：

シナリオ: "${scenario}"
会話履歴: ${JSON.stringify(exchanges)}

以下の項目について評価してください：

1. 総合スコア（100点満点）
2. 文法の正確性
3. 語彙の豊富さと適切性
4. 流暢さと自然さ
5. ビジネス英語としての適切性
6. 具体的な改善点
7. 次回の学習目標

スコアと詳細な分析を含む包括的なフィードバックを提供してください。`;

        const response = await callGeminiAPI(prompt, true);
        
        // Extract score from response (simple pattern matching)
        const scoreMatch = response.match(/(\d+)点|\b(\d+)\/100\b|\b(\d+)%/);
        const score = scoreMatch ? parseInt(scoreMatch[1] || scoreMatch[2] || scoreMatch[3]) : 75;
        
        res.json({ 
            response,
            score: Math.min(Math.max(score, 0), 100) // Ensure score is between 0-100
        });
    } catch (error) {
        console.error('Generate report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Renderの環境でのポート設定
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Gemini API configured: ${!!GEMINI_API_KEY}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Server started successfully`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});