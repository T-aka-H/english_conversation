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
    // req.path はミドルウェアが適用されるパスからの相対パス
    // app.use('/api', verifyPassword) の場合、/api/health は /health となる
    if (req.path === '/health') { 
        return next(); // ヘルスチェックはパスワード不要
    }
    
    const { password } = req.body; 

    if (!password || password !== VALID_PASSWORD) {
        console.warn('Unauthorized access attempt:', req.ip, req.path);
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Valid password required' 
        });
    }
    next();
}

// /api 以下すべてのルートに verifyPassword ミドルウェアを適用
// ★これ一つでOKです。他の app.use('/api', ...) は削除してください。
app.use('/api', verifyPassword); 

// Function to call Gemini API (Gemini 1.5 Flash)
async function callGeminiAPI(prompt) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        return text;
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        // API呼び出しエラーを明確にするため、エラーを再スロー
        throw new Error(`Gemini API call failed: ${error.message || error}`);
    }
}

// 1. 英会話応答のエンドポイント
app.post('/api/chat', async (req, res, next) => {
    try {
        // フロントエンドから送信されるデータを受け取る
        // conversation.html の generateAIResponse 関数から送られることを想定
        const { userMessage, conversationHistory, scenarioName, difficultyLevel } = req.body;

        // プロンプトの構築（AIのペルソナ、会話履歴、シナリオ、難易度、応答形式、訂正指示などを盛り込む）
        // 会話履歴を整形してプロンプトに含める
        const formattedHistory = conversationHistory.map(msg => 
            `${msg.role === 'user' ? 'ユーザー' : 'AI'}: ${msg.content}`
        ).join('\n');

        const prompt = `あなたはプロの英会話講師であり、ユーザーの英語学習をサポートするAIです。
現在の会話シナリオは「${scenarioName}」で、難易度は「${difficultyLevel}」です。
ユーザーは英語学習者なので、自然で、かつ学習の助けになるような応答を心がけてください。
応答は2〜4文程度にしてください。
もしユーザーの英語に間違いがあれば、自然な形で優しく訂正し、より良い表現を提案してください。

これまでの会話履歴:
${formattedHistory}

ユーザー: ${userMessage}

あなたの応答:`;

        // Gemini APIを呼び出し、応答を生成
        const aiResponse = await callGeminiAPI(prompt);
        
        // フロントエンドに応答を返す
        res.json({ generatedText: aiResponse }); // フロントエンドが `generatedText` キーで受け取る

    } catch (error) {
        console.error('Error processing /api/chat request:', error);
        // エラーハンドリングミドルウェアにエラーを渡す
        next(error); 
    }
});

// 2. 英語評価のエンドポイント（オプション）
// 会話とは別に、特定のタイミングでユーザーの英語力を評価する用途を想定
app.post('/api/evaluate', async (req, res, next) => {
    try {
        const { targetMessage, fullConversationHistory, scenarioName, difficultyLevel } = req.body;

        // 評価に特化したプロンプト
        const evaluationPrompt = `あなたはプロの英語試験官/講師です。
以下のユーザーの発言と、その時点までの会話履歴を考慮し、ユーザーの英語力（文法、語彙、流暢さ）を0〜100のスコアで評価し、具体的なフィードバックと改善点を日本語で簡潔に提供してください。
現在の会話シナリオは「${scenarioName}」、難易度は「${difficultyLevel}」です。
ユーザーの発言は以下の通りです: "${targetMessage}"

これまでの会話履歴の抜粋（参考用、直近の数ターンに絞る）:
${fullConversationHistory.slice(-5).map(msg => `${msg.role === 'user' ? 'ユーザー' : 'AI'}: ${msg.content}`).join('\n')}

評価のフォーマット:
スコア: [点数]/100
フィードバック:
[具体的なフィードバックと改善点。例: 時制の一致ができていません。より自然な表現として〜が使えます。]
`;
        
        const evaluationResult = await callGeminiAPI(evaluationPrompt);

        // Geminiからの応答をパース（例: スコアとフィードバックを分ける）
        let score = 0;
        let feedback = evaluationResult;
        const scoreMatch = evaluationResult.match(/スコア:\s*(\d+)\/100/);
        if (scoreMatch && scoreMatch[1]) {
            score = parseInt(scoreMatch[1], 10);
            // スコアの部分をフィードバックから除去
            feedback = evaluationResult.replace(/スコア:\s*\d+\/100\s*/, '').trim();
        }

        res.json({ score: score, feedback: feedback });

    } catch (error) {
        console.error('Error processing /api/evaluate request:', error);
        next(error);
    }
});


// Health check endpoint
// このエンドポイントはパスワード認証をスキップするように設定されているため、
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
// ルートパス (http://your-render-url.com/) で conversation.html を提供
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'conversation.html'));
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
    res.status(404).json({ error: 'Not found', message: 'The requested resource was not found.' });
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Access the app at http://localhost:${port}/`); // ルートパスで conversation.html を提供
    console.log('Ensure GEMINI_API_KEY and APP_PASSWORD are set in RENDER environment variables.');
});