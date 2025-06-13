// server.js
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
// dotenv は RENDER環境変数を使うため不要です。
// ローカルでのテスト時に.envを使いたい場合は require('dotenv').config(); を追加してください。

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
const VALID_PASSWORD = process.env.APP_PASSWORD; 
if (!VALID_PASSWORD) {
    console.error('Error: APP_PASSWORD is not set in environment variables.');
    console.error('Please set it in RENDER\'s Environment Variables for authentication.');
    process.exit(1); // パスワードがない場合はサーバーを終了
}

function verifyPassword(req, res, next) {
    const { password } = req.body;
    
    // Health checkはパスワードなしで許可
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

// APIルートにパスワード認証を適用
app.use('/api', (req, res, next) => {
    // '/api/health' 以外の /api ルートに適用
    if (req.path === '/api/health') { // req.path は '/api/health' となるはず
        return next();
    }
    verifyPassword(req, res, next);
});

// Function to call Gemini API (Gemini 1.5 Flash)
async function callGeminiAPI(prompt, isEvaluation = false) {
    try {
        const modelName = isEvaluation ? "gemini-1.5-flash" : "gemini-1.5-flash"; // 評価用も同じモデル
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let geminiResponseText = response.text();

        console.log("Gemini Raw Response (Before Cleanup):", geminiResponseText); // デバッグ用

        // JSONパースの堅牢化
        let parsedResponse;
        try {
            // 1. レスポンス文字列の先頭・末尾の空白をトリム
            let cleanedResponseText = geminiResponseText.trim();

            // 2. Renderのログタイムスタンプを除去
            // 例: "Jun 13 07:47:44 PM" のような行を削除
            // 複数行にわたる可能性があるため 'gm' フラグを使用
            cleanedResponseText = cleanedResponseText.replace(/^Jun \d{1,2} \d{2}:\d{2}:\d{2} PM\s*\n?/gm, '').trim();

            // 3. ```json と ``` で囲まれた部分を抽出する
            const jsonMatch = cleanedResponseText.match(/```json\s*(\{[\s\S]*?\})\s*```/);

            if (jsonMatch && jsonMatch[1]) {
                parsedResponse = JSON.parse(jsonMatch[1]);
            } else {
                // ```json がない場合でも、純粋なJSON文字列としてパースを試みる
                // ただし、ログで見られたような末尾の余分な '{' に対応
                if (cleanedResponseText.endsWith('} {')) { // もし "}" と "{" の間にスペースがあれば
                    cleanedResponseText = cleanedResponseText.slice(0, -2).trim(); // "{ " を削除
                } else if (cleanedResponseText.endsWith('{')) {
                    cleanedResponseText = cleanedResponseText.slice(0, -1).trim(); // 最後の "{" を削除
                }
                
                // 念のため、それでも残っている可能性のある ```json や ``` を取り除く
                cleanedResponseText = cleanedResponseText.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();

                parsedResponse = JSON.parse(cleanedResponseText);
            }
        } catch (parseError) {
            console.error("Failed to parse Gemini response as JSON after cleanup:", parseError);
            throw new Error("Invalid JSON response from AI after cleanup: " + geminiResponseText);
        }
        
        console.log("Parsed Gemini Response:", parsedResponse); // デバッグ用

        return parsedResponse; // オブジェクトとして返す
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("Failed to get response from AI. Please try again.");
    }
}

// API endpoint to handle chat messages
app.post('/api/chat', verifyPassword, async (req, res) => {
    const { history, userMessage, scenario, difficulty, isFirstMessage } = req.body;

    if (!userMessage && !isFirstMessage) {
        return res.status(400).json({ error: 'User message is required.' });
    }

    let conversationHistory = history || [];

    // プロンプト生成ロジックの修正
    let prompt = "";
    if (isFirstMessage) {
        // AIからの最初のメッセージ生成プロンプト
        prompt = `
You are an English business conversation practice AI. Based on the following scenario and difficulty level, start a conversation with the user.
Your goal is to help the user improve their English communication skills in the given scenario.
Evaluate the user's responses and provide appropriate feedback and next responses.

Scenario: ${scenario}
Difficulty: ${difficulty}

Constraints:
- Respond only in English.
- Start with a question or situation description based on the scenario to prompt user response.
- For each response, provide an evaluation (score and feedback) and a next question or response.
- Return each response in JSON format as follows:
{
  "aiResponse": "Your next response in English",
  "feedback": "Evaluation and improvement points in Japanese (brief)",
  "score": 100  // For first message, always return 100 as there's no user input to evaluate
}

Remember to maintain a natural conversation flow and keep responses concise and business-appropriate.`;
    } else {
        // 会話が続いている場合のプロンプト
        prompt = `
You are an English business conversation practice AI. Based on the conversation history and the user's latest message, evaluate the user's response and continue the conversation.

Current Scenario: ${scenario}
Current Difficulty: ${difficulty}

Conversation History (alternating between AI and user):
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}
User: ${userMessage}

Your tasks:
1. Evaluate the user's latest message on a scale of 0-100, considering grammar, vocabulary, fluency, and appropriateness to the scenario.
2. Provide specific feedback and improvement points in Japanese (brief).
3. Generate your next response in English, maintaining a natural conversation flow.
4. Return your response in JSON format as follows:
{
  "aiResponse": "Your next response in English",
  "feedback": "Evaluation and improvement points in Japanese (brief)",
  "score": <evaluation score between 0-100>
}

Keep responses concise and business-appropriate.`;
    }

    try {
        const geminiResponse = await callGeminiAPI(prompt);
        
        // 応答の検証と整形
        let aiResponse = geminiResponse.aiResponse;
        let feedback = geminiResponse.feedback;
        let score = geminiResponse.score;

        // 型チェックとデフォルト値の設定
        if (typeof aiResponse !== 'string') {
            console.error('Invalid aiResponse type:', typeof aiResponse);
            aiResponse = "I apologize, but I'm having trouble generating a proper response. Could you please try again?";
        }

        if (typeof feedback !== 'string') {
            console.error('Invalid feedback type:', typeof feedback);
            feedback = "評価を生成できませんでした。もう一度お試しください。";
        }

        if (typeof score !== 'number' || isNaN(score)) {
            console.error('Invalid score type:', typeof score);
            score = isFirstMessage ? 100 : 50; // 最初のメッセージなら100、それ以外は50をデフォルト値に
        }

        // スコアの範囲を0-100に制限
        score = Math.max(0, Math.min(100, Math.round(score)));

        res.json({ aiResponse, feedback, score });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ 
            error: 'Failed to process chat message', 
            message: error.message || 'An unexpected error occurred.' 
        });
    }
});


// API endpoint to finalize conversation and get overall report
app.post('/api/finalize', verifyPassword, async (req, res) => {
    const { conversationHistory, scenario, difficulty } = req.body;

    if (!conversationHistory || conversationHistory.length === 0) {
        return res.status(400).json({ error: 'Conversation history is empty.' });
    }

    const evaluationPrompt = `
あなたは英語のビジネス会話練習AIです。以下のシナリオと会話履歴全体を評価し、最終レポートを作成してください。
シナリオ: ${scenario}
難易度: ${difficulty}
会話履歴:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

あなたのタスク：
1. 会話全体を通じたユーザーの英語力（文法、語彙、流暢さ、発音など）について総合的に評価してください（日本語）。
2. シナリオへの対応、コミュニケーション能力、ビジネス英語の適切さについて具体的にフィードバックしてください（日本語）。
3. 今後の学習に向けた推奨事項や改善点を提供してください（日本語）。
4. 会話全体の総合点数を100点満点で算出してください（整数）。
5. 各評価項目は以下のようにJSON形式で提供してください。
{
  "overallEvaluation": "総合評価（日本語）",
  "scenarioPerformance": "シナリオ対応とコミュニケーション能力（日本語）",
  "recommendations": "今後の推奨事項（日本語）",
  "overallScore": 総合点数（0-100の整数）
}
`;

    try {
        const geminiResponse = await callGeminiAPI(evaluationPrompt, true); // オブジェクトとして受け取る
        const { overallEvaluation, scenarioPerformance, recommendations, overallScore } = geminiResponse; // 分割代入

        if (typeof overallEvaluation !== 'string' || typeof scenarioPerformance !== 'string' || typeof recommendations !== 'string' || typeof overallScore !== 'number') {
            throw new Error('AI evaluation response is not in the expected format.');
        }

        res.json({ overallEvaluation, scenarioPerformance, recommendations, overallScore });

    } catch (error) {
        console.error('Error in /api/finalize:', error);
        // フォールバックレスポンスを返す
        const fallbackResponse = {
            overallEvaluation: "AIからの評価を取得できませんでした。ネットワーク接続を確認するか、後で再度お試しください。",
            scenarioPerformance: "AIからの評価を取得できませんでした。",
            recommendations: "AIからの推奨事項を取得できませんでした。今回の経験を活かして、より複雑なビジネス状況にも挑戦してみましょう。",
            overallScore: 50 // エラー時のデフォルトスコア
        };
        
        res.json(fallbackResponse);
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
// ルートパス ([http://your-render-url.com/](http://your-render-url.com/)) で index.html を提供
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    console.log(`Access the application at http://localhost:${port}`);
    console.log(`Health check: http://localhost:${port}/api/health`);
});