// server.js
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
// dotenv はローカル環境でのみ使用します。
// RENDER環境変数を使う場合は、この行と dotenv.config(); は不要です。
// ローカルでのテスト時に.envを使いたい場合は require('dotenv').config(); を追加してください。
require('dotenv').config(); // ★追加: .envファイルから環境変数を読み込む

const app = express();
const port = process.env.PORT || 3000; // 環境変数PORTがあればそれを使用、なければ3000

// Middleware
app.use(express.json()); // JSONリクエストボディのパースを有効化
app.use(express.static('public')); // publicフォルダ内の静的ファイル（例: conversation.html）を提供

// Initialize Gemini AI
const API_KEY = process.env.GEMINI_API_KEY; // RENDER環境変数からAPIキーを読み込み
if (!API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set in environment variables.');
    console.error('Please set it in RENDER\'s Environment Variables.');
    process.exit(1); // APIキーがない場合はサーバーを終了
}
const genAI = new GoogleGenerativeAI(API_KEY);

// Password verification middleware
// APP_PASSWORDもRENDER環境変数から読み込みます
const VALID_PASSWORD = process.env.APP_ACCESS_PASSWORD; // ★修正: APP_PASSWORD から APP_ACCESS_PASSWORD に変更 (フロントエンドと合わせる)
if (!VALID_PASSWORD) {
    console.error('Error: APP_ACCESS_PASSWORD is not set in environment variables.'); // ★修正
    console.error('Please set it in RENDER\'s Environment Variables for authentication.');
    process.exit(1); // パスワードがない場合はサーバーを終了
}

function verifyPassword(req, res, next) {
    const { password } = req.body;

    // Health check endpoint allows access without password
    if (req.path === '/api/health') {
        return next();
    }

    if (!password || password !== VALID_PASSWORD) {
        console.warn('Unauthorized access attempt from IP:', req.ip, 'with password:', password); // ログ強化
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid password required'
        });
    }

    next();
}

// Apply password verification to API routes
// '/api' プレフィックスを持つすべてのルートに認証ミドルウェアを適用
app.use('/api', (req, res, next) => {
    // '/api/health' は認証をスキップ
    if (req.path === '/health' || req.path === '/health/') { // 両方のパターンに対応
        return next();
    }
    verifyPassword(req, res, next);
});

// Function to call Gemini API (Gemini 1.5 Flash)
async function callGeminiAPI(promptContent, history = [], isEvaluation = false) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    if (isEvaluation) {
        const result = await model.generateContent(promptContent);
        const response = await result.response;
        return response.text();
    }

    // Chat logic
    const chat = model.startChat({
        history: history,
        generationConfig: {
            maxOutputTokens: 200,
        },
    });

    const result = await chat.sendMessage(promptContent);
    const response = await result.response;
    return response.text();
}

// Chat endpoint
app.post('/api/chat', async (req, res) => { // verifyPasswordはapp.useで既に適用されているため、ここからは削除
    const { userMessage, conversationHistory, scenarioName, difficultyLevel } = req.body;

    try {
        let chatHistoryForGemini = [];
        let promptForGemini;

        // Check if this is the very first message request from the frontend's load event
        // This is indicated by conversationHistory containing only the initial prompt from the client
        const isInitialPromptForFirstMessage = conversationHistory.length === 1 &&
                                               conversationHistory[0].role === 'user' &&
                                               conversationHistory[0].content.includes("Start the conversation with an appropriate opening sentence based on this scenario and difficulty.");

        if (isInitialPromptForFirstMessage) {
            // For the AI's first utterance (triggered by the client on page load)
            promptForGemini = `You are an English conversation partner. The user wants to practice English in a scenario: "${scenarioName}" at a "${difficultyLevel}" level. Your task is to start the conversation with a single, appropriate opening sentence based on this context. Do not ask for user's input, just start the conversation.`;
            chatHistoryForGemini = []; // Start with an empty history for this specific AI-driven prompt
            console.log("AI initiating conversation with prompt:", promptForGemini);
        } else {
            // For subsequent messages, reconstruct chat history from the client
            chatHistoryForGemini = conversationHistory.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model', // Gemini API expects 'model' for AI responses
                parts: [{ text: msg.content }]
            }));
            // The actual user message for this turn is passed to sendMessage
            promptForGemini = userMessage;
            console.log("Continuing conversation with user message:", userMessage, "History length:", chatHistoryForGemini.length);
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({
            history: chatHistoryForGemini, // Use the prepared history
            generationConfig: {
                maxOutputTokens: 200,
            },
        });

        const result = await chat.sendMessage(promptForGemini); // Send the correct prompt/message
        const responseText = result.response.text();

        res.json({ generatedText: responseText });

    } catch (error) {
        console.error('Error generating AI response:', error);
        res.status(500).json({ error: 'Failed to generate AI response', message: error.message });
    }
});


// Evaluation endpoint
app.post('/api/evaluate', async (req, res) => { // verifyPasswordはapp.useで既に適用されているため、ここからは削除
    const { targetMessage, fullConversationHistory, scenarioName, difficultyLevel } = req.body;

    if (!targetMessage) {
        return res.status(400).json({ error: 'Evaluation target message is required.' });
    }

    try {
        // fullConversationHistory を使用して、より詳細な評価プロンプトを構築
        const evaluationPrompt = `
        You are an English conversation evaluator. Evaluate the user's English proficiency based on their full conversation history in the context of the "${scenarioName}" scenario at a "${difficultyLevel}" difficulty level.

        User's full conversation transcript (your responses are included for context):
        ${fullConversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}`).join('\n')}

        Based on the user's contributions (messages with 'User:' prefix), provide a numerical score from 1 to 100 for their overall English proficiency (grammar, vocabulary, fluency, relevance to scenario).
        Then, provide detailed feedback in Japanese, focusing on:
        1.  **文法 (Grammar)**: 具体的な誤りを挙げ、修正案を提示してください。
        2.  **語彙 (Vocabulary)**: より適切または豊富な語彙の提案をしてください。
        3.  **流暢さ (Fluency)**: 会話の流れ、自然さについてコメントしてください。
        4.  **シナリオへの適合性 (Relevance to Scenario)**: シナリオに沿った発言であったか、改善点があれば教えてください。
        5.  **総合的なアドバイス (Overall Advice)**: 今後の学習に向けた具体的なアドバイスを提案してください。

        Format your response as follows:

        SCORE: [数値スコア]
        FEEDBACK:
        **文法**: ...
        **語彙**: ...
        **流暢さ**: ...
        **シナリオへの適合性**: ...
        **総合的なアドバイス**: ...
        `;

        const evaluationResult = await callGeminiAPI(evaluationPrompt, [], true); // isEvaluation = true

        const scoreMatch = evaluationResult.match(/SCORE:\s*(\d+)/);
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

        const feedbackMatch = evaluationResult.match(/FEEDBACK:([\s\S]*)/);
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : "フィードバックを生成できませんでした。";

        res.json({ score, feedback });

    } catch (error) {
        console.error('Error during evaluation:', error);
        // Fallback for evaluation failure
        const fallbackScore = Math.floor(Math.random() * 20) + 70; // 70-90のランダムスコア
        const fallbackFeedback = `
        評価中に問題が発生しました。一時的なエラーの可能性があります。
        仮のスコアは ${fallbackScore} です。

        【今後の学習の推奨】
        今回の経験を活かして、より複雑なビジネス状況にも挑戦してみましょう。
        `;

        res.status(500).json({
            error: 'Failed to evaluate conversation',
            message: error.message,
            score: fallbackScore, // エラー時も仮のスコアとフィードバックを返す
            feedback: fallbackFeedback
        });
    }
});


// Health check endpoint
// サーバーが正常に動作しているか外部から確認できます。
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        model: 'gemini-1.5-flash', // 使用しているモデル
        hasApiKey: !!process.env.GEMINI_API_KEY, // APIキーが設定されているか
        passwordProtected: true // パスワード認証を使用していることを示す
    });
});

// Serve the main HTML file
// ルートパス (http://your-render-url.com/) で index.html を提供（ログインページ）
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // ★修正: index.html に変更
});

// Error handling middleware (すべての一時的なエラーをここで捕捉)
app.use((error, req, res, next) => {
    console.error('Global Server Error:', error); // エラー内容をサーバーログに出力

    // 開発環境では詳細なエラーメッセージを、本番環境では一般的なメッセージを返す
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong. Please try again later.'
    });
});

// 404 handler (存在しないルートへのアクセス)
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Access password from .env: ${process.env.APP_ACCESS_PASSWORD ? 'Loaded' : 'Not Loaded'}`); // ★修正
    if (!process.env.GEMINI_API_KEY) {
        console.warn('WARNING: GEMINI_API_KEY is not set in .env file!');
    }
});