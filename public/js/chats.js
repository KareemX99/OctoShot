/**
 * Chats Page JavaScript
 */

const socket = io();

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const chatsList = document.getElementById('chatsList');
const chatSearch = document.getElementById('chatSearch');
const chatView = document.getElementById('chatView');
const chatHeader = document.getElementById('chatHeader');
const messagesContainer = document.getElementById('messagesContainer');
const messagesList = document.getElementById('messagesList');
const messageInputContainer = document.getElementById('messageInputContainer');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const chatUserName = document.getElementById('chatUserName');
const chatUserNumber = document.getElementById('chatUserNumber');
const newChatBtn = document.getElementById('newChatBtn');
const newChatModal = document.getElementById('newChatModal');
const closeNewChatModal = document.getElementById('closeNewChatModal');
const cancelNewChat = document.getElementById('cancelNewChat');
const startNewChat = document.getElementById('startNewChat');
const newChatNumber = document.getElementById('newChatNumber');
const toastContainer = document.getElementById('toastContainer');

// State
let currentChatId = null;
let chats = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadChats();
    initSocketListeners();
    initEventListeners();
});

function initTheme() {
    const isDark = localStorage.getItem('theme') === 'dark';
    if (isDark) {
        document.body.classList.add('dark-theme');
    }
}

function initEventListeners() {
    // Search
    chatSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const items = chatsList.querySelectorAll('.chat-item');
        items.forEach(item => {
            const name = item.querySelector('.chat-name').textContent.toLowerCase();
            item.style.display = name.includes(query) ? 'flex' : 'none';
        });
    });

    // Message form
    messageForm.addEventListener('submit', handleSendMessage);

    // Attach file
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // New chat modal
    newChatBtn.addEventListener('click', () => newChatModal.classList.remove('hidden'));
    closeNewChatModal.addEventListener('click', () => newChatModal.classList.add('hidden'));
    cancelNewChat.addEventListener('click', () => newChatModal.classList.add('hidden'));
    startNewChat.addEventListener('click', handleStartNewChat);
}

function initSocketListeners() {
    socket.on('status', (data) => {
        updateConnectionStatus(data.status);
    });

    socket.on('message', (msg) => {
        // Add message to current chat if it belongs to it
        if (currentChatId && msg.from === currentChatId) {
            addMessageToList(msg, false);
        }
        // Refresh chats list
        loadChats();
    });
}

function updateConnectionStatus(status) {
    if (status === 'connected') {
        connectionBadge.classList.add('connected');
        connectionBadge.querySelector('.status-text').textContent = 'متصل';
    } else {
        connectionBadge.classList.remove('connected');
        connectionBadge.querySelector('.status-text').textContent = 'غير متصل';
    }
}

async function loadChats() {
    try {
        chatsList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>جاري التحميل...</p></div>';

        // Try to load from WhatsApp first
        let response = await fetch('/api/whatsapp/chats?limit=100');
        let data = await response.json();

        if (!data.success) {
            // Fallback to database
            response = await fetch('/api/messages');
            data = await response.json();
        }

        if (data.success && data.data.length > 0) {
            chats = data.data.map(chat => ({
                chat_id: chat.id || chat.chat_id,
                from_name: chat.name || chat.from_name,
                body: chat.lastMessage?.body || chat.body || '',
                timestamp: chat.lastMessage?.timestamp || chat.timestamp,
                isGroup: chat.isGroup || false,
                unreadCount: chat.unreadCount || 0,
                profilePicUrl: chat.profilePicUrl || null
            }));
            renderChatsList();
        } else {
            chatsList.innerHTML = `
                <div class="empty-state">
                    <span>💬</span>
                    <p>لا توجد محادثات</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading chats:', error);
        chatsList.innerHTML = `
            <div class="empty-state">
                <span>❌</span>
                <p>فشل في تحميل المحادثات</p>
            </div>
        `;
    }
}

function renderChatsList() {
    chatsList.innerHTML = chats.map(chat => {
        const avatarContent = chat.profilePicUrl
            ? `<img src="${chat.profilePicUrl}" alt="" class="chat-avatar-img" onerror="this.parentElement.innerHTML='${chat.isGroup ? '👥' : '👤'}'"/>`
            : (chat.isGroup ? '👥' : '👤');

        const unreadBadge = chat.unreadCount > 0
            ? `<span class="unread-badge">${chat.unreadCount}</span>`
            : '';

        return `
            <div class="chat-item ${chat.chat_id === currentChatId ? 'active' : ''} ${chat.unreadCount > 0 ? 'has-unread' : ''}" 
                 data-chat-id="${chat.chat_id}"
                 onclick="selectChat('${chat.chat_id}')">
                <div class="chat-avatar">${avatarContent}</div>
                <div class="chat-info">
                    <div class="chat-name">${chat.from_name || formatNumber(chat.chat_id)}</div>
                    <div class="chat-preview">${chat.body?.substring(0, 30) || ''}${chat.body?.length > 30 ? '...' : ''}</div>
                </div>
                <div class="chat-meta">
                    <div class="chat-time">${formatTime(chat.timestamp)}</div>
                    ${unreadBadge}
                </div>
            </div>
        `;
    }).join('');
}

async function selectChat(chatId) {
    currentChatId = chatId;

    // Update active state in list
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.toggle('active', item.dataset.chatId === chatId);
    });

    // Show chat view elements
    document.querySelector('.chat-placeholder').classList.add('hidden');
    chatHeader.classList.remove('hidden');
    messagesContainer.classList.remove('hidden');
    messageInputContainer.classList.remove('hidden');

    // Update header
    const chat = chats.find(c => c.chat_id === chatId);
    if (chat) {
        chatUserName.textContent = chat.from_name || 'Unknown';
        chatUserNumber.textContent = formatNumber(chatId);
    }

    // Load messages
    await loadMessages(chatId);
}

async function loadMessages(chatId) {
    try {
        messagesList.innerHTML = '<div class="loading-messages"><div class="spinner"></div></div>';

        // Try to load from WhatsApp first for real-time messages
        let response = await fetch(`/api/whatsapp/chat/${encodeURIComponent(chatId)}/messages?limit=50`);
        let data = await response.json();

        if (!data.success) {
            // Fallback to database
            response = await fetch(`/api/messages/chat/${encodeURIComponent(chatId)}?limit=50`);
            data = await response.json();
        }

        if (data.success && data.data) {
            messagesList.innerHTML = '';
            // Messages come in reverse order (newest first), so reverse them
            const messages = [...data.data].reverse();
            messages.forEach(msg => {
                addMessageToList(msg, msg.fromMe || msg.is_from_me);
            });
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            messagesList.innerHTML = '<div class="empty-messages"><p>لا توجد رسائل</p></div>';
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        messagesList.innerHTML = '<div class="empty-messages"><p>فشل في تحميل الرسائل</p></div>';
    }
}

function addMessageToList(msg, isFromMe) {
    const msgEl = document.createElement('div');
    msgEl.className = `msg-bubble ${isFromMe ? 'sent' : 'received'}`;

    let senderInfo = '';
    // For group messages, show sender name
    if (!isFromMe && msg.author && currentChatId && currentChatId.includes('@g.us')) {
        const senderName = msg.author || msg.from;
        const displayName = senderName.replace('@c.us', '').replace('@s.whatsapp.net', '');
        senderInfo = `<div class="msg-sender">${displayName}</div>`;
    }

    msgEl.innerHTML = `
        ${senderInfo}
        <div class="msg-text">${msg.body || ''}</div>
        <div class="msg-time">${formatTime(msg.timestamp)}</div>
    `;
    messagesList.appendChild(msgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function handleSendMessage(e) {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (!message || !currentChatId) return;

    // Send the full chatId (supports both individual and group chats)
    const phoneNumber = currentChatId; // Use full chat ID

    try {
        const response = await fetch('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber, message })
        });

        const data = await response.json();

        if (data.success) {
            addMessageToList({ body: message, timestamp: new Date() }, true);
            messageInput.value = '';
        } else {
            showToast(data.error || 'فشل في الإرسال', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ في الإرسال', 'error');
    }
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !currentChatId) return;

    // Use full chat ID for groups and individuals
    const phoneNumber = currentChatId;
    const formData = new FormData();
    formData.append('media', file);
    formData.append('phoneNumber', phoneNumber);

    try {
        const response = await fetch('/api/send-media', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            addMessageToList({ body: `📎 ${file.name}`, timestamp: new Date() }, true);
            showToast('تم إرسال الملف', 'success');
        } else {
            showToast(data.error || 'فشل في إرسال الملف', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ في إرسال الملف', 'error');
    }

    fileInput.value = '';
}

function handleStartNewChat() {
    const number = newChatNumber.value.trim();
    if (!number) {
        showToast('أدخل رقم الهاتف', 'warning');
        return;
    }

    const chatId = `${number}@c.us`;
    newChatModal.classList.add('hidden');
    newChatNumber.value = '';

    // Add to chats and select
    if (!chats.find(c => c.chat_id === chatId)) {
        chats.unshift({
            chat_id: chatId,
            from_name: null,
            body: ''
        });
        renderChatsList();
    }

    selectChat(chatId);
}

function formatNumber(chatId) {
    if (!chatId) return '-';
    return chatId.replace('@c.us', '').replace('@g.us', '');
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️' };
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Make selectChat globally accessible
window.selectChat = selectChat;
