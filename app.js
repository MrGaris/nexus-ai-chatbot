// ===== NexusAI Chatbot =====
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = 'GH_SECRET_OPENROUTER_API_KEY';
const DEFAULT_MODEL = 'openai/gpt-oss-120b:free';

// Supabase Configuration
const SUPABASE_URL = 'https://cuyxplgotvxzhlxzxhwr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3wHwg5P8CSgb48E3RstwmQ_lqoKFRgE';
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const DEFAULT_SYSTEM = 'Ви — корисний та дружній AI-асистент NexusAI. Відповідайте українською мовою, якщо користувач не вказав іншу. Будьте точними, інформативними та корисними.';

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
    applyTheme(state.theme);
    el.themeToggle.checked = state.theme === 'light';
    el.tempSlider.value = state.temperature;
    el.tempValue.textContent = state.temperature;
    el.streamToggle.checked = state.streaming;
    el.systemPromptInput.value = state.systemPrompt;
    bindEvents();
    renderChatList();
    updateStats();
    await checkUser();
    if (state.user) {
        await syncChatsFromSupabase();
    } else if (state.chats.length > 0) {
        loadChat(state.chats[0].id);
    }
}

async function syncChatsFromSupabase() {
    if (!supabase || !state.user) return;
    const { data, error } = await supabase
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
}

async function checkUser() {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        state.user = user;
        updateUIForUser();
    }
}

function updateUIForUser() {
    if (state.user) {
        $('profile-name').textContent = state.user.user_metadata?.full_name || state.user.email.split('@')[0];
        $('profile-email').textContent = state.user.email;
        $('btn-login').innerHTML = '<span>Вийти</span>';
        $('btn-login').onclick = handleLogout;
    } else {
        $('profile-name').textContent = 'Гість';
        $('profile-email').textContent = 'guest@nexusai.local';
        $('btn-login').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg><span>Увійти / Зареєструватися</span>';
        $('btn-login').onclick = () => el.authModal.classList.add('open');
    }
}

// ===== Events =====
function bindEvents() {
    el.messageInput.addEventListener('input', onInputChange);
    el.messageInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    el.btnSend.addEventListener('click', sendMessage);
    el.btnStop.addEventListener('click', stopGeneration);
    el.btnNewChat.addEventListener('click', newChat);
    el.btnToggleLeft.addEventListener('click', toggleLeftSidebar);
    el.btnToggleRight.addEventListener('click', () => el.sidebarRight.classList.toggle('open'));
    el.btnCloseRight.addEventListener('click', () => el.sidebarRight.classList.remove('open'));
    el.btnClearAll.addEventListener('click', clearAllChats);
    el.searchChats.addEventListener('input', renderChatList);
    el.themeToggle.addEventListener('change', () => {
        state.theme = el.themeToggle.checked ? 'light' : 'dark';
        applyTheme(state.theme);
        localStorage.setItem('nexus_theme', state.theme);
    });
    el.tempSlider.addEventListener('input', () => {
        state.temperature = parseFloat(el.tempSlider.value);
        el.tempValue.textContent = state.temperature;
        localStorage.setItem('nexus_temp', state.temperature);
    });
    el.streamToggle.addEventListener('change', () => {
        state.streaming = el.streamToggle.checked;
        localStorage.setItem('nexus_stream', state.streaming);
    });
    el.modelSelector.addEventListener('click', () => el.modelDropdown.classList.toggle('open'));
    document.addEventListener('click', e => {
        if (!el.modelSelector.contains(e.target) && !el.modelDropdown.contains(e.target))
            el.modelDropdown.classList.remove('open');
    });
    el.btnSystemPrompt.addEventListener('click', () => el.systemPromptModal.classList.add('open'));
    el.btnCloseModal.addEventListener('click', () => el.systemPromptModal.classList.remove('open'));
    el.btnSavePrompt.addEventListener('click', () => {
        state.systemPrompt = el.systemPromptInput.value || DEFAULT_SYSTEM;
        localStorage.setItem('nexus_system', state.systemPrompt);
        el.systemPromptModal.classList.remove('open');
        showToast('Системний промпт збережено', 'success');
    });
    el.btnResetPrompt.addEventListener('click', () => {
        el.systemPromptInput.value = DEFAULT_SYSTEM;
        state.systemPrompt = DEFAULT_SYSTEM;
        localStorage.setItem('nexus_system', DEFAULT_SYSTEM);
        showToast('Промпт скинуто', 'success');
    });
    el.btnLogin.addEventListener('click', () => el.authModal.classList.add('open'));
    el.btnCloseAuth.addEventListener('click', () => el.authModal.classList.remove('open'));
    
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            $('auth-form-login').classList.toggle('hidden', tab.dataset.tab !== 'login');
            $('auth-form-register').classList.toggle('hidden', tab.dataset.tab !== 'register');
            $('auth-modal-title').textContent = tab.dataset.tab === 'login' ? 'Вхід' : 'Реєстрація';
        });
    });

    $('auth-form-login').addEventListener('submit', handleLogin);
    $('auth-form-register').addEventListener('submit', handleRegister);

    document.querySelectorAll('.suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            el.messageInput.value = card.dataset.prompt;
            onInputChange();
            sendMessage();
        });
    });

    [el.systemPromptModal, el.authModal].forEach(modal => {
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
    });
}

function onInputChange() {
    const v = el.messageInput.value;
    el.btnSend.disabled = !v.trim();
    el.charCount.textContent = v.length > 0 ? v.length : '';
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

    if (state.user && supabase) {
        const { data, error } = await supabase
            .from('chats')
            .insert([{ title: chat.title, user_id: state.user.id, messages: [] }])
            .select();
        if (data) {
            state.chats.unshift(data[0]);
            state.activeChatId = data[0].id;
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
    el.welcomeScreen.classList.remove('hidden');
    el.messagesContainer.innerHTML = '';
    el.messageInput.value = '';
    onInputChange();
    renderChatList();
    el.messageInput.focus();
}

function loadChat(id) {
    const chat = state.chats.find(c => c.id === id);
    if (!chat) return;
    state.activeChatId = id;
    el.welcomeScreen.classList.add('hidden');
    el.messagesContainer.innerHTML = '';
    chat.messages.forEach(m => appendMessage(m.role, m.content, false));
    renderChatList();
    scrollToBottom();
}

async function deleteChat(id) {
    if (state.user && supabase) {
        await supabase.from('chats').delete().eq('id', id);
    }
    state.chats = state.chats.filter(c => c.id !== id);
    saveChats();
    if (state.activeChatId === id) newChat();
    renderChatList();
    updateStats();
}

async function saveChats() {
    if (state.user && supabase && state.activeChatId) {
        const chat = state.chats.find(c => c.id === state.activeChatId);
        if (chat) {
            await supabase
                .from('chats')
                .update({ messages: chat.messages })
                .eq('id', state.activeChatId);
        }
    } else {
        localStorage.setItem('nexus_chats', JSON.stringify(state.chats));
    }
}

function renderChatList() {
    const q = el.searchChats.value.toLowerCase();
    const now = Date.now();
    const day = 86400000;
    const today = [], week = [], older = [];

    state.chats.forEach(c => {
        if (q && !c.title.toLowerCase().includes(q)) return;
        const age = now - new Date(c.created_at || c.created).getTime();
        if (age < day) today.push(c);
        else if (age < day * 7) week.push(c);
        else older.push(c);
    });

    const render = (list, container) => {
        const section = container.closest('.sidebar-section');
        if (list.length === 0) { section.style.display = 'none'; return; }
        section.style.display = '';
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
        container.querySelectorAll('.chat-item').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.closest('.delete-chat')) return;
                loadChat(el.dataset.id);
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
    if (API_KEY === 'GH_SECRET_OPENROUTER_API_KEY') {
        showToast('Помилка: API Key не налаштовано на GitHub Secrets!', 'error');
        return;
    }
    const text = el.messageInput.value.trim();
    if (!text) return;

    if (!state.activeChatId) {
        const title = text.length > 40 ? text.substring(0, 40) + '…' : text;
        const chat = await createChat(title);
        el.welcomeScreen.classList.add('hidden');
        renderChatList();
    }

    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (!chat) return;

    chat.messages.push({ role: 'user', content: text });
    appendMessage('user', text);
    el.messageInput.value = '';
    onInputChange();
    saveChats();
    scrollToBottom();

    el.btnSend.classList.add('hidden');
    el.btnStop.classList.remove('hidden');
    const typingEl = appendTypingIndicator();

    const apiMessages = [{ role: 'system', content: state.systemPrompt }];
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
        typingEl.remove();
        if (err.name !== 'AbortError') {
            appendMessage('assistant', `❌ Помилка: ${err.message}`);
            showToast('Помилка запиту', 'error');
        }
    } finally {
        el.btnSend.classList.remove('hidden');
        el.btnStop.classList.add('hidden');
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

    typingEl.remove();
    const msgDiv = appendMessage('assistant', '');
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
    typingEl.remove();
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
    el.chatArea.scrollTop = el.chatArea.scrollHeight;
}

function toggleLeftSidebar() {
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
    el.statMessages.textContent = msgs;
    el.statChats.textContent = state.chats.length;
    el.statTokens.textContent = Math.round(msgs * 150);
}

function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    el.toastContainer.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

async function handleRegister(e) {
    e.preventDefault();
    if (!supabase) return;
    const email = $('reg-email').value;
    const password = $('reg-password').value;
    const name = $('reg-name').value;

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } }
    });

    if (error) {
        showToast(error.message, 'error');
    } else {
        showToast('Перевірте пошту для підтвердження!', 'success');
        el.authModal.classList.remove('open');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    if (!supabase) return;
    const email = $('login-email').value;
    const password = $('login-password').value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        showToast(error.message, 'error');
    } else {
        state.user = data.user;
        updateUIForUser();
        el.authModal.classList.remove('open');
        showToast('Вітаємо, ' + (state.user.user_metadata?.full_name || email), 'success');
    }
}

async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    state.user = null;
    updateUIForUser();
    showToast('Ви вийшли з аккаунту', 'success');
}

init();
