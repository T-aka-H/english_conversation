// Global variables
let currentTurn = 0;
let conversationHistory = [];
let isRecording = false;
let recognition;
let currentScenario = '';
let sessionData = {
    scenario: '',
    exchanges: [],
    finalScore: 0,
    finalFeedback: ''
};

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initSpeechRecognition();
    updateProgress();
});

// Initialize speech recognition
function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        
        recognition.lang = 'en-US';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        
        recognition.onstart = () => {
            console.log('Speech recognition started');
            document.getElementById('speechStatus').textContent = '🎤 音声を認識中...';
        };
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            document.getElementById('textResponse').value = transcript;
            document.getElementById('speechStatus').textContent = '✅ 音声認識完了: ' + transcript;
            console.log('Speech recognition result:', transcript);
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            let errorMessage = '音声認識エラー: ';
            switch(event.error) {
                case 'network':
                    errorMessage += 'ネットワークエラー';
                    break;
                case 'not-allowed':
                    errorMessage += 'マイクへのアクセスが拒否されました';
                    break;
                case 'no-speech':
                    errorMessage += '音声が検出されませんでした';
                    break;
                default:
                    errorMessage += event.error;
            }
            document.getElementById('speechStatus').textContent = '❌ ' + errorMessage;
        };
        
        recognition.onend = () => {
            console.log('Speech recognition ended');
            isRecording = false;
            updateVoiceButton();
        };
    } else {
        console.log('Speech recognition not supported');
        document.getElementById('voiceButton').disabled = true;
        document.getElementById('speechStatus').textContent = '⚠️ このブラウザは音声認識をサポートしていません';
    }
}

function updateVoiceButton() {
    const button = document.getElementById('voiceButton');
    const text = document.getElementById('voiceButtonText');
    
    if (isRecording) {
        button.classList.add('recording');
        text.textContent = '⏹️ 録音停止';
    } else {
        button.classList.remove('recording');
        text.textContent = '🎤 音声で回答';
    }
}

function toggleRecording() {
    if (!recognition) {
        showError('音声認識がサポートされていません');
        return;
    }

    if (isRecording) {
        recognition.stop();
        document.getElementById('speechStatus').textContent = '🔄 音声認識を停止しています...';
    } else {
        document.getElementById('textResponse').value = '';
        document.getElementById('speechStatus').textContent = '🎤 音声認識を開始しています...';
        try {
            recognition.start();
            isRecording = true;
            updateVoiceButton();
        } catch (error) {
            console.error('Failed to start recognition:', error);
            showError('音声認識の開始に失敗しました');
        }
    }
}

function updateProgress() {
    const progress = (currentTurn / 10) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('turnCounter').textContent = `Turn ${currentTurn} / 10`;
}

function addMessage(content, type) {
    const conversation = document.getElementById('conversation');
    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = content;
    conversation.appendChild(message);
    conversation.scrollTop = conversation.scrollHeight;
    
    // Add to conversation history for context
    conversationHistory.push({
        type: type,
        content: content,
        timestamp: new Date().toISOString()
    });
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => {
        errorDiv.classList.add('hidden');
    }, 5000);
}

function showLoading(show = true) {
    const loadingDiv = document.getElementById('waitingForAI');
    if (show) {
        loadingDiv.classList.remove('hidden');
    } else {
        loadingDiv.classList.add('hidden');
    }
}

// API call helper function
async function callAPI(endpoint, data) {
    try {
        const response = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

async function startLearning() {
    const scenario = document.getElementById('scenario').value.trim();
    if (!scenario) {
        showError('シナリオを入力してください');
        return;
    }

    currentScenario = scenario;
    sessionData.scenario = scenario;
    sessionData.exchanges = [];
    
    document.getElementById('setupSection').classList.add('hidden');
    document.getElementById('learningSection').classList.remove('hidden');
    
    showLoading(true);
    
    try {
        // Get initial AI response
        const result = await callAPI('start-conversation', { scenario });
        
        addMessage(result.response, 'ai');
        
        sessionData.exchanges.push({
            turn: currentTurn,
            aiMessage: result.response,
            userResponse: '',
            feedback: '',
            needsImprovement: false
        });
        
        document.getElementById('responseSection').classList.remove('hidden');
        showLoading(false);
        
    } catch (error) {
        showError('会話の開始に失敗しました: ' + error.message);
        showLoading(false);
        // Return to setup
        document.getElementById('learningSection').classList.add('hidden');
        document.getElementById('setupSection').classList.remove('hidden');
    }
}

async function submitResponse() {
    const userResponse = document.getElementById('textResponse').value.trim();
    if (!userResponse) {
        showError('回答を入力してください');
        return;
    }

    addMessage(userResponse, 'user');
    document.getElementById('responseSection').classList.add('hidden');
    showLoading(true);

    try {
        // Get conversation context for better evaluation
        const conversationContext = conversationHistory
            .slice(-4) // Last 4 messages for context
            .map(msg => `${msg.type}: ${msg.content}`)
            .join('\n');

        // Evaluate user response
        const evaluationResult = await callAPI('evaluate-response', {
            userResponse,
            scenario: currentScenario,
            conversationContext
        });
        
        const feedback = evaluationResult.response;
        addMessage(feedback, 'feedback');
        
        // Update session data
        if (sessionData.exchanges.length > 0) {
            const lastExchange = sessionData.exchanges[sessionData.exchanges.length - 1];
            lastExchange.userResponse = userResponse;
            lastExchange.feedback = feedback;
        }
        
        // Check if response needs improvement
        const needsImprovement = feedback.includes('修正') || 
                               feedback.includes('改善') || 
                               feedback.includes('間違い') ||
                               feedback.includes('直して') ||
                               feedback.includes('正しい表現');
        
        if (needsImprovement) {
            // Needs improvement - ask for retry
            if (sessionData.exchanges.length > 0) {
                sessionData.exchanges[sessionData.exchanges.length - 1].needsImprovement = true;
            }
            
            document.getElementById('textResponse').value = '';
            document.getElementById('speechStatus').textContent = '';
            document.getElementById('responseSection').classList.remove('hidden');
            showLoading(false);
        } else {
            // Good response - continue conversation
            currentTurn++;
            updateProgress();
            
            if (currentTurn >= 10) {
                // Session complete - generate final report
                await generateFinalReport();
            } else {
                // Continue conversation
                const continueResult = await callAPI('continue-conversation', {
                    userResponse,
                    scenario: currentScenario,
                    conversationHistory: conversationHistory.slice(-6).map(msg => `${msg.type}: ${msg.content}`).join('\n')
                });
                
                addMessage(continueResult.response, 'ai');
                
                sessionData.exchanges.push({
                    turn: currentTurn,
                    aiMessage: continueResult.response,
                    userResponse: '',
                    feedback: '',
                    needsImprovement: false
                });
                
                document.getElementById('textResponse').value = '';
                document.getElementById('speechStatus').textContent = '';
                document.getElementById('responseSection').classList.remove('hidden');
                showLoading(false);
            }
        }
        
    } catch (error) {
        showError('回答の評価に失敗しました: ' + error.message);
        document.getElementById('responseSection').classList.remove('hidden');
        showLoading(false);
    }
}

async function generateFinalReport() {
    document.getElementById('learningSection').classList.add('hidden');
    showLoading(true);
    
    try {
        const reportResult = await callAPI('generate-report', {
            scenario: currentScenario,
            exchanges: sessionData.exchanges
        });
        
        sessionData.finalScore = reportResult.score || 75;
        sessionData.finalFeedback = reportResult.response;
        
        document.getElementById('finalScore').textContent = `${sessionData.finalScore}/100`;
        document.getElementById('finalFeedback').textContent = sessionData.finalFeedback;
        
        showLoading(false);
        document.getElementById('reportSection').classList.remove('hidden');
        
    } catch (error) {
        showError('レポートの生成に失敗しました: ' + error.message);
        showLoading(false);
        // Show a basic report
        sessionData.finalScore = 75;
        sessionData.finalFeedback = '申し訳ございませんが、詳細なレポートの生成に失敗しました。しかし、あなたの英語学習への取り組みは素晴らしいものでした。継続して練習を続けてください。';
        
        document.getElementById('finalScore').textContent = `${sessionData.finalScore}/100`;
        document.getElementById('finalFeedback').textContent = sessionData.finalFeedback;
        document.getElementById('reportSection').classList.remove('hidden');
    }
}

function downloadReport() {
    const timestamp = new Date().toLocaleString('ja-JP');
    const reportContent = `AI English Learning - 学習レポート

═══════════════════════════════════════
　　　　　　学習セッション結果
═══════════════════════════════════════

📅 学習日時: ${timestamp}
🎯 シナリオ: ${sessionData.scenario}
📊 最終スコア: ${sessionData.finalScore}/100点

═══════════════════════════════════════
　　　　　　総合評価とフィードバック
═══════════════════════════════════════

${sessionData.finalFeedback}

═══════════════════════════════════════
　　　　　　会話履歴詳細
═══════════════════════════════════════

${sessionData.exchanges.map((exchange, index) => `
【ターン ${index + 1}】
🤖 AI: ${exchange.aiMessage}

👤 あなた: ${exchange.userResponse || '(未回答)'}

💡 フィードバック: ${exchange.feedback || '(評価中)'}

${exchange.needsImprovement ? '⚠️ 改善が必要でした' : '✅ 良い回答でした'}

────────────────────────────────────
`).join('')}

═══════════════════════════════════════
　　　　　　学習統計
═══════════════════════════════════════

✅ 完了ターン数: ${currentTurn}/10
🔄 改善を要した回答: ${sessionData.exchanges.filter(e => e.needsImprovement).length}回
⭐ 一発で通った回答: ${sessionData.exchanges.filter(e => !e.needsImprovement && e.userResponse).length}回

═══════════════════════════════════════
　　　　　　今後の学習アドバイス
═══════════════════════════════════════

📚 継続的な練習を心がけてください
🎯 様々なビジネスシナリオに挑戦しましょう
💪 文法と語彙の基礎固めも大切です
🗣️ 音声でのコミュニケーションも積極的に活用しましょう

───────────────────────────────────────
Generated by AI English Learning System
───────────────────────────────────────
`;
    
    try {
        const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `English_Learning_Report_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Show success message
        const originalText = document.querySelector('.report-actions .button').textContent;
        document.querySelector('.report-actions .button').textContent = '✅ ダウンロード完了!';
        setTimeout(() => {
            document.querySelector('.report-actions .button').textContent = originalText;
        }, 2000);
        
    } catch (error) {
        console.error('Download failed:', error);
        showError('レポートのダウンロードに失敗しました');
    }
}

function restart() {
    // Reset all global variables
    currentTurn = 0;
    conversationHistory = [];
    currentScenario = '';
    sessionData = {
        scenario: '',
        exchanges: [],
        finalScore: 0,
        finalFeedback: ''
    };
    
    // Clear all input fields
    document.getElementById('scenario').value = '';
    document.getElementById('textResponse').value = '';
    document.getElementById('conversation').innerHTML = '';
    document.getElementById('speechStatus').textContent = '';
    
    // Reset progress
    updateProgress();
    
    // Reset UI state
    document.getElementById('reportSection').classList.add('hidden');
    document.getElementById('learningSection').classList.add('hidden');
    document.getElementById('responseSection').classList.add('hidden');
    document.getElementById('setupSection').classList.remove('hidden');
    
    // Stop any ongoing speech recognition
    if (isRecording && recognition) {
        recognition.stop();
    }
    isRecording = false;
    updateVoiceButton();
}