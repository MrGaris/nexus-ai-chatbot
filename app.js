// ===== NexusAI Chatbot =====
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
let API_KEY = 'GH_SECRET_OPENROUTER_API_KEY';
const DEFAULT_MODEL = 'openai/gpt-oss-120b:free';

// Підготовка API ключа: якщо ми локально і ключ не замінено GitHub Actions
if (API_KEY.includes('GH_SECRET')) {
    let savedKey = localStorage.getItem('local_api_key');
    if (!savedKey) {
        savedKey = prompt('Для локального тестування введіть OpenRouter API Key (або натисніть Скасувати):');
        if (savedKey) localStorage.setItem('local_api_key', savedKey);
    }
    API_KEY = savedKey || '';
}

// Supabase Configuration
const SUPABASE_URL = 'https://cuyxplgotvxzhlxzxhwr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3wHwg5P8CSgb48E3RstwmQ_lqoKFRgE';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const DEFAULT_SYSTEM = '';

// ===== State =====
let state = {
    user: null,
    chats: JSON.parse(localStorage.getItem('nexus_chats') || '[]'),
    activeChatId: null,
    temperature: parseFloat(localStorage.getItem('nexus_temp') || '0.7'),
    streaming: localStorage.getItem('nexus_stream') !== 'false',
    systemPrompt: localStorage.getItem('nexus_system') || DEFAULT_SYSTEM,
    theme: localStorage.getItem('nexus_theme') || 'dark',
    totalMessages: 0,
    totalTokens: 0,
    abortController: null
};

// ===== DOM =====
const $ = id => document.getElementById(id);
const el = {
    sidebarLeft: $('sidebar-left'),
    sidebarRight: $('sidebar-right'),
    chatArea: $('chat-area'),
    welcomeScreen: $('welcome-screen'),
    messagesContainer: $('messages-container'),
    messageInput: $('message-input'),
    btnSend: $('btn-send'),
    btnStop: $('btn-stop'),
    btnNewChat: $('btn-new-chat'),
    btnToggleLeft: $('btn-toggle-left'),
    btnToggleRight: $('btn-toggle-right'),
    btnCloseRight: $('btn-close-right'),
    btnClearAll: $('btn-clear-all'),
    chatListToday: $('chat-list-today'),
    chatListWeek: $('chat-list-week'),
    chatListOlder: $('chat-list-older'),
    searchChats: $('search-chats'),
    charCount: $('char-count'),
    themeToggle: $('theme-toggle'),
    tempSlider: $('temperature-slider'),
    tempValue: $('temp-value'),
    streamToggle: $('streaming-toggle'),
    modelSelector: $('model-selector'),
    modelDropdown: $('model-dropdown'),
    systemPromptModal: $('system-prompt-modal'),
    systemPromptInput: $('system-prompt-input'),
    btnSystemPrompt: $('btn-system-prompt'),
    btnCloseModal: $('btn-close-modal'),
    btnSavePrompt: $('btn-save-prompt'),
    btnResetPrompt: $('btn-reset-prompt'),
    authModal: $('auth-modal'),
    btnLogin: $('btn-login'),
    btnCloseAuth: $('btn-close-auth'),
    statMessages: $('stat-messages'),
    statChats: $('stat-chats'),
    statTokens: $('stat-tokens'),
    toastContainer: $('toast-container'),
    inputWrapper: $('input-wrapper')
};

// ===== Init =====
async function init() {
    try {
        applyTheme(state.theme);
        if(el.themeToggle) el.themeToggle.checked = state.theme === 'light';
        if(el.tempSlider) el.tempSlider.value = state.temperature;
        if(el.tempValue) el.tempValue.textContent = state.temperature;
        if(el.streamToggle) el.streamToggle.checked = state.streaming;
        if(el.systemPromptInput) el.systemPromptInput.value = state.systemPrompt;
        
        bindEvents();
        renderChatList();
        updateStats();
        
        await checkUser();
        
        if (state.user) {
            await syncChatsFromSupabase();
        } else if (state.chats.length > 0) {
            loadChat(state.chats[0].id);
        }
    } catch (err) {
        console.error("Initialization error:", err);
    }
}

async function syncChatsFromSupabase() {
    if (!supabaseClient || !state.user) return;
    try {
        const { data, error } = await supabaseClient
            .from('chats')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (data) {
            state.chats = data;
            renderChatList();
            if (data.length > 0 && !state.activeChatId) {
                loadChat(data[0].id);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function checkUser() {
    if (!supabaseClient) return;
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
            state.user = user;
            updateUIForUser();
        } else {
            updateUIForUser();
        }
    } catch (e) {
        console.error(e);
        updateUIForUser();
    }
}

function updateUIForUser() {
    const profileName = $('profile-name');
    const profileEmail = $('profile-email');
    const btnLogin = $('btn-login');

    if (state.user) {
        if(profileName) profileName.textContent = state.user.user_metadata?.full_name || state.user.email.split('@')[0];
        if(profileEmail) profileEmail.textContent = state.user.email;
        if(btnLogin) {
            btnLogin.innerHTML = '<span>Вийти</span>';
            btnLogin.onclick = handleLogout;
        }
    } else {
        if(profileName) profileName.textContent = 'Гість';
        if(profileEmail) profileEmail.textContent = 'guest@nexusai.local';
        if(btnLogin) {
            btnLogin.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg><span>Увійти / Зареєструватися</span>';
            btnLogin.onclick = () => {
                if(el.authModal) el.authModal.classList.add('open');
            };
        }
    }
}

// ===== Events =====
function bindEvents() {
    if(el.messageInput) {
        el.messageInput.addEventListener('input', onInputChange);
        el.messageInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
    }
    if(el.btnSend) el.btnSend.addEventListener('click', sendMessage);
    if(el.btnStop) el.btnStop.addEventListener('click', stopGeneration);
    if(el.btnNewChat) el.btnNewChat.addEventListener('click', newChat);
    
    if(el.btnToggleLeft) el.btnToggleLeft.addEventListener('click', toggleLeftSidebar);
    if(el.btnToggleRight) el.btnToggleRight.addEventListener('click', () => {
        el.sidebarRight.classList.add('open');
    });
    if(el.btnCloseRight) el.btnCloseRight.addEventListener('click', () => {
        el.sidebarRight.classList.remove('open');
    });
    
    if(el.btnClearAll) el.btnClearAll.addEventListener('click', clearAllChats);
    if(el.searchChats) el.searchChats.addEventListener('input', renderChatList);
    
    if(el.themeToggle) el.themeToggle.addEventListener('change', () => {
        state.theme = el.themeToggle.checked ? 'light' : 'dark';
        applyTheme(state.theme);
        localStorage.setItem('nexus_theme', state.theme);
    });
    if(el.tempSlider) el.tempSlider.addEventListener('input', () => {
        state.temperature = parseFloat(el.tempSlider.value);
        if(el.tempValue) el.tempValue.textContent = state.temperature;
        localStorage.setItem('nexus_temp', state.temperature);
    });
    if(el.streamToggle) el.streamToggle.addEventListener('change', () => {
        state.streaming = el.streamToggle.checked;
        localStorage.setItem('nexus_stream', state.streaming);
    });
    
    if(el.modelSelector) el.modelSelector.addEventListener('click', () => {
        if(el.modelDropdown) el.modelDropdown.classList.toggle('open');
    });
    
    document.addEventListener('click', e => {
        if (el.modelSelector && el.modelDropdown && !el.modelSelector.contains(e.target) && !el.modelDropdown.contains(e.target)) {
            el.modelDropdown.classList.remove('open');
        }
    });
    
    if(el.btnSystemPrompt) el.btnSystemPrompt.addEventListener('click', () => {
        if(el.systemPromptModal) el.systemPromptModal.classList.add('open');
    });
    if(el.btnCloseModal) el.btnCloseModal.addEventListener('click', () => {
        if(el.systemPromptModal) el.systemPromptModal.classList.remove('open');
    });
    if(el.btnSavePrompt) el.btnSavePrompt.addEventListener('click', () => {
        state.systemPrompt = el.systemPromptInput ? el.systemPromptInput.value.trim() : '';
        localStorage.setItem('nexus_system', state.systemPrompt);
        if(el.systemPromptModal) el.systemPromptModal.classList.remove('open');
        showToast('Системний промпт збережено', 'success');
    });
    if(el.btnResetPrompt) el.btnResetPrompt.addEventListener('click', () => {
        if(el.systemPromptInput) el.systemPromptInput.value = DEFAULT_SYSTEM;
        state.systemPrompt = DEFAULT_SYSTEM;
        localStorage.setItem('nexus_system', DEFAULT_SYSTEM);
        showToast('Промпт скинуто', 'success');
    });
    
    if(el.btnLogin) el.btnLogin.addEventListener('click', () => {
        if(el.authModal) el.authModal.classList.add('open');
    });
    if(el.btnCloseAuth) el.btnCloseAuth.addEventListener('click', () => {
        if(el.authModal) el.authModal.classList.remove('open');
    });
    
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const formLogin = $('auth-form-login');
            const formReg = $('auth-form-register');
            if(formLogin) formLogin.classList.toggle('hidden', tab.dataset.tab !== 'login');
            if(formReg) formReg.classList.toggle('hidden', tab.dataset.tab !== 'register');
            const authTitle = $('auth-modal-title');
            if(authTitle) authTitle.textContent = tab.dataset.tab === 'login' ? 'Вхід' : 'Реєстрація';
        });
    });

    const formLogin = $('auth-form-login');
    const formReg = $('auth-form-register');
    if(formLogin) formLogin.addEventListener('submit', handleLogin);
    if(formReg) formReg.addEventListener('submit', handleRegister);

    document.querySelectorAll('.suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            if(el.messageInput) {
                el.messageInput.value = card.dataset.prompt;
                onInputChange();
                sendMessage();
            }
        });
    });

    [el.systemPromptModal, el.authModal].forEach(modal => {
        if(modal) {
            modal.addEventListener('click', e => { 
                if (e.target === modal) modal.classList.remove('open'); 
            });
        }
    });
}

function onInputChange() {
    const v = el.messageInput.value;
    el.btnSend.disabled = !v.trim();
    if(el.charCount) el.charCount.textContent = v.length > 0 ? v.length : '';
    el.messageInput.style.height = 'auto';
    el.messageInput.style.height = Math.min(el.messageInput.scrollHeight, 160) + 'px';
}

async function createChat(title) {
    const chat = { 
        id: state.user ? undefined : Date.now().toString(), 
        title: title || 'Новий чат', 
        messages: [], 
        created_at: new Date().toISOString() 
    };

    if (state.user && supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('chats')
                .insert([{ title: chat.title, user_id: state.user.id, messages: [] }])
                .select();
            if (data && data.length > 0) {
                state.chats.unshift(data[0]);
                state.activeChatId = data[0].id;
            } else {
                // Fallback if supabase fails
                chat.id = Date.now().toString();
                state.chats.unshift(chat);
                state.activeChatId = chat.id;
            }
        } catch(e) {
            console.error(e);
            chat.id = Date.now().toString();
            state.chats.unshift(chat);
            state.activeChatId = chat.id;
        }
    } else {
        chat.id = Date.now().toString();
        state.chats.unshift(chat);
        state.activeChatId = chat.id;
        saveChats();
    }
    return chat;
}

function newChat() {
    state.activeChatId = null;
    if(el.welcomeScreen) el.welcomeScreen.classList.remove('hidden');
    if(el.messagesContainer) el.messagesContainer.innerHTML = '';
    if(el.messageInput) el.messageInput.value = '';
    onInputChange();
    renderChatList();
    if(el.messageInput) el.messageInput.focus();
}

function loadChat(id) {
    const chat = state.chats.find(c => c.id === id);
    if (!chat) return;
    state.activeChatId = id;
    if(el.welcomeScreen) el.welcomeScreen.classList.add('hidden');
    if(el.messagesContainer) el.messagesContainer.innerHTML = '';
    chat.messages.forEach(m => appendMessage(m.role, m.content, false));
    renderChatList();
    scrollToBottom();
}

async function deleteChat(id) {
    if (state.user && supabaseClient) {
        try {
            await supabaseClient.from('chats').delete().eq('id', id);
        } catch(e) {
            console.error(e);
        }
    }
    state.chats = state.chats.filter(c => c.id !== id);
    saveChats();
    if (state.activeChatId === id) newChat();
    renderChatList();
    updateStats();
}

function clearAllChats() {
    if (!confirm('Очистити всю історію чатів?')) return;
    if (state.user && supabaseClient) {
        // Just clear locally for now to avoid accidental full db wipes, but ideally would call supabase
        state.chats = [];
    } else {
        state.chats = [];
    }
    saveChats();
    newChat();
    updateStats();
    showToast('Історію очищено', 'success');
}

async function saveChats() {
    if (state.user && supabaseClient && state.activeChatId) {
        const chat = state.chats.find(c => c.id === state.activeChatId);
        if (chat) {
            try {
                await supabaseClient
                    .from('chats')
                    .update({ messages: chat.messages })
                    .eq('id', state.activeChatId);
            } catch(e) {
                console.error(e);
            }
        }
    } else {
        localStorage.setItem('nexus_chats', JSON.stringify(state.chats));
    }
}

function renderChatList() {
    if (!el.searchChats) return;
    const q = el.searchChats.value.toLowerCase();
    const now = Date.now();
    const day = 86400000;
    const today = [], week = [], older = [];

    state.chats.forEach(c => {
        if (q && !c.title.toLowerCase().includes(q)) return;
        const age = now - new Date(c.created_at || c.created || Date.now()).getTime();
        if (age < day) today.push(c);
        else if (age < day * 7) week.push(c);
        else older.push(c);
    });

    const render = (list, container) => {
        if(!container) return;
        const section = container.closest('.sidebar-section');
        if (list.length === 0) { if(section) section.style.display = 'none'; return; }
        if(section) section.style.display = '';
        container.innerHTML = list.map(c => `
            <div class="chat-item ${c.id === state.activeChatId ? 'active' : ''}" data-id="${c.id}">
                <span>${escapeHtml(c.title)}</span>
                <button class="delete-chat" data-id="${c.id}" title="Видалити">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `).join('');
        container.querySelectorAll('.chat-item').forEach(itemEl => {
            itemEl.addEventListener('click', e => {
                if (e.target.closest('.delete-chat')) return;
                loadChat(itemEl.dataset.id);
            });
        });
        container.querySelectorAll('.delete-chat').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); deleteChat(btn.dataset.id); });
        });
    };

    render(today, el.chatListToday);
    render(week, el.chatListWeek);
    render(older, el.chatListOlder);
}

function appendMessage(role, content, animate = true) {
    if(!el.messagesContainer) return null;
    const div = document.createElement('div');
    div.className = `message ${role}`;
    if (!animate) div.style.animation = 'none';

    const avatarIcon = role === 'user'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';

    const name = role === 'user' ? 'Ви' : 'NexusAI';

    div.innerHTML = `
        <div class="message-header">
            <div class="message-avatar">${avatarIcon}</div>
            <span class="message-name">${name}</span>
        </div>
        <div class="message-content">${formatMarkdown(content)}</div>
    `;
    el.messagesContainer.appendChild(div);
    
    div.querySelectorAll('pre').forEach(pre => {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = 'Копіювати';
        btn.onclick = () => {
            navigator.clipboard.writeText(pre.textContent.replace('Копіювати', '').trim());
            btn.textContent = '✓';
            setTimeout(() => btn.textContent = 'Копіювати', 1500);
        };
        pre.appendChild(btn);
    });
    return div;
}

function appendTypingIndicator() {
    if(!el.messagesContainer) return null;
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = 'typing-msg';
    div.innerHTML = `
        <div class="message-header">
            <div class="message-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span class="message-name">NexusAI</span>
        </div>
        <div class="message-content">
            <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>
    `;
    el.messagesContainer.appendChild(div);
    scrollToBottom();
    return div;
}

async function sendMessage() {
    if (!API_KEY || API_KEY.includes('GH_SECRET')) {
        showToast('Помилка: API Key не налаштовано! Оновіть сторінку і введіть ключ.', 'error');
        return;
    }
    const text = el.messageInput ? el.messageInput.value.trim() : '';
    if (!text) return;

    if (!state.activeChatId) {
        const title = text.length > 40 ? text.substring(0, 40) + '…' : text;
        const chat = await createChat(title);
        if(el.welcomeScreen) el.welcomeScreen.classList.add('hidden');
        renderChatList();
    }

    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (!chat) return;

    chat.messages.push({ role: 'user', content: text });
    appendMessage('user', text);
    if(el.messageInput) el.messageInput.value = '';
    onInputChange();
    saveChats();
    scrollToBottom();

    if(el.btnSend) el.btnSend.classList.add('hidden');
    if(el.btnStop) el.btnStop.classList.remove('hidden');
    const typingEl = appendTypingIndicator();

    const apiMessages = [];
    if (state.systemPrompt) {
        apiMessages.push({ role: 'system', content: state.systemPrompt });
    }
    
    const recent = chat.messages.slice(-20);
    recent.forEach(m => apiMessages.push({ role: m.role, content: m.content }));

    state.abortController = new AbortController();

    try {
        if (state.streaming) {
            await streamResponse(apiMessages, typingEl, chat);
        } else {
            await normalResponse(apiMessages, typingEl, chat);
        }
    } catch (err) {
        if(typingEl) typingEl.remove();
        if (err.name !== 'AbortError') {
            appendMessage('assistant', `❌ Помилка: ${err.message}`);
            showToast('Помилка запиту', 'error');
        }
    } finally {
        if(el.btnSend) el.btnSend.classList.remove('hidden');
        if(el.btnStop) el.btnStop.classList.add('hidden');
        state.abortController = null;
        updateStats();
    }
}

async function streamResponse(messages, typingEl, chat) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: DEFAULT_MODEL, messages, stream: true, temperature: state.temperature }),
        signal: state.abortController.signal
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API ${res.status}: ${err}`);
    }

    if(typingEl) typingEl.remove();
    const msgDiv = appendMessage('assistant', '');
    if(!msgDiv) return;
    
    const contentEl = msgDiv.querySelector('.message-content');
    let fullText = '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                    fullText += delta;
                    if(contentEl) {
                        contentEl.innerHTML = formatMarkdown(fullText);
                        contentEl.querySelectorAll('pre:not(:has(.copy-btn))').forEach(pre => {
                            const btn = document.createElement('button');
                            btn.className = 'copy-btn';
                            btn.textContent = 'Копіювати';
                            btn.onclick = () => {
                                navigator.clipboard.writeText(pre.textContent.replace('Копіювати', '').trim());
                                btn.textContent = '✓';
                                setTimeout(() => btn.textContent = 'Копіювати', 1500);
                            };
                            pre.appendChild(btn);
                        });
                    }
                    scrollToBottom();
                }
            } catch {}
        }
    }

    chat.messages.push({ role: 'assistant', content: fullText });
    saveChats();
}

async function normalResponse(messages, typingEl, chat) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: DEFAULT_MODEL, messages, temperature: state.temperature }),
        signal: state.abortController.signal
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API ${res.status}: ${err}`);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || 'Немає відповіді';
    if(typingEl) typingEl.remove();
    appendMessage('assistant', content);
    chat.messages.push({ role: 'assistant', content });
    saveChats();
    scrollToBottom();
}

function stopGeneration() {
    if (state.abortController) {
        state.abortController.abort();
        showToast('Генерацію зупинено', 'success');
    }
}

function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code class="language-${lang}">${code.trim()}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><(h[1-3]|pre|ul|ol|blockquote)/g, '<$1');
    html = html.replace(/<\/(h[1-3]|pre|ul|ol|blockquote)><\/p>/g, '</$1>');
    html = html.replace(/<p><\/p>/g, '');
    return html;
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function scrollToBottom() {
    if(el.chatArea) el.chatArea.scrollTop = el.chatArea.scrollHeight;
}

function toggleLeftSidebar() {
    if (!el.sidebarLeft) return;
    if (window.innerWidth <= 768) {
        el.sidebarLeft.classList.toggle('mobile-open');
    } else {
        el.sidebarLeft.classList.toggle('collapsed');
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function updateStats() {
    let msgs = 0;
    state.chats.forEach(c => msgs += c.messages.length);
    if(el.statMessages) el.statMessages.textContent = msgs;
    if(el.statChats) el.statChats.textContent = state.chats.length;
    if(el.statTokens) el.statTokens.textContent = Math.round(msgs * 150);
}

function showToast(msg, type = 'success') {
    if(!el.toastContainer) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    el.toastContainer.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

async function handleRegister(e) {
    e.preventDefault();
    if (!supabaseClient) {
        showToast('Помилка підключення до бази', 'error');
        return;
    }
    const email = $('reg-email').value;
    const password = $('reg-password').value;
    const name = $('reg-name').value;

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } }
        });

        if (error) {
            showToast(error.message, 'error');
        } else {
            showToast('Успішно! Тепер можете увійти.', 'success');
            if(el.authModal) el.authModal.classList.remove('open');
        }
    } catch(err) {
        showToast('Помилка реєстрації', 'error');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    if (!supabaseClient) {
        showToast('Помилка підключення до бази', 'error');
        return;
    }
    const email = $('login-email').value;
    const password = $('login-password').value;

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) {
            showToast(error.message, 'error');
        } else {
            state.user = data.user;
            updateUIForUser();
            if(el.authModal) el.authModal.classList.remove('open');
            showToast('Вітаємо, ' + (state.user.user_metadata?.full_name || email), 'success');
        }
    } catch(err) {
        showToast('Помилка входу', 'error');
    }
}

async function handleLogout() {
    if (!supabaseClient) return;
    try {
        await supabaseClient.auth.signOut();
    } catch(e) {
        console.error(e);
    }
    state.user = null;
    updateUIForUser();
    showToast('Ви вийшли з аккаунту', 'success');
}

// Ensure the code runs after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
