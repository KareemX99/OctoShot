/**
 * Dashboard Page JavaScript
 */

const socket = io();

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const sentToday = document.getElementById('sentToday');
const receivedToday = document.getElementById('receivedToday');
const totalMessages = document.getElementById('totalMessages');
const totalContacts = document.getElementById('totalContacts');
const recentMessages = document.getElementById('recentMessages');
const totalRules = document.getElementById('totalRules');
const activeRules = document.getElementById('activeRules');
const connStatus = document.getElementById('connStatus');
const connNumber = document.getElementById('connNumber');
const connName = document.getElementById('connName');
const refreshBtn = document.getElementById('refreshBtn');
const syncContactsBtn = document.getElementById('syncContactsBtn');
const themeToggle = document.getElementById('themeToggle');
const toastContainer = document.getElementById('toastContainer');

// Theme
let isDarkTheme = localStorage.getItem('theme') === 'dark';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadDashboardData();
    initSocketListeners();
    initEventListeners();
});

function initTheme() {
    if (isDarkTheme) {
        document.body.classList.add('dark-theme');
        themeToggle.querySelector('.theme-icon').textContent = '☀️';
    }
}

function initEventListeners() {
    themeToggle.addEventListener('click', () => {
        isDarkTheme = !isDarkTheme;
        document.body.classList.toggle('dark-theme');
        themeToggle.querySelector('.theme-icon').textContent = isDarkTheme ? '☀️' : '🌙';
        localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
    });

    refreshBtn.addEventListener('click', loadDashboardData);

    syncContactsBtn.addEventListener('click', syncContacts);
}

function initSocketListeners() {
    socket.on('status', (data) => {
        updateConnectionStatus(data.status);
    });

    socket.on('ready', (data) => {
        updateConnectionStatus('connected');
        if (data.info) {
            connNumber.textContent = data.info.wid?.user || '-';
            connName.textContent = data.info.pushname || '-';
        }
    });

    socket.on('message', () => {
        // Refresh data when new message arrives
        loadDashboardData();
    });

    // Campaign events - refresh when campaign status changes
    socket.on('campaign:completed', () => {
        loadDashboardData();
    });

    socket.on('campaign:status_updated', () => {
        loadDashboardData();
    });

    socket.on('campaign:progress', () => {
        loadDashboardData();
    });
}

function updateConnectionStatus(status) {
    const statusMap = {
        'disconnected': 'غير متصل',
        'qr': 'في انتظار المسح',
        'authenticated': 'تم التحقق',
        'connected': 'متصل',
        'auth_failure': 'فشل التحقق'
    };

    connStatus.textContent = statusMap[status] || status;

    if (status === 'connected') {
        connectionBadge.classList.add('connected');
        connectionBadge.querySelector('.status-text').textContent = 'متصل';
    } else {
        connectionBadge.classList.remove('connected');
        connectionBadge.querySelector('.status-text').textContent = statusMap[status] || 'غير متصل';
    }
}

async function loadDashboardData() {
    try {
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();

        if (data.success) {
            // Update stats
            sentToday.textContent = data.data.messages.sent || 0;
            receivedToday.textContent = data.data.messages.received || 0;
            totalMessages.textContent = data.data.messages.total || 0;
            totalContacts.textContent = data.data.contacts.total || 0;
            totalRules.textContent = data.data.autoReplies.total || 0;
            activeRules.textContent = data.data.autoReplies.active || 0;

            // Update connection info
            if (data.data.connection.connected) {
                updateConnectionStatus('connected');
                connNumber.textContent = data.data.connection.phoneNumber || '-';
                connName.textContent = data.data.connection.name || '-';
            }
        }

        // Load recent messages
        loadRecentMessages();
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function loadRecentMessages() {
    try {
        const response = await fetch('/api/dashboard/recent-messages?limit=5');
        const data = await response.json();

        if (data.success && data.data.length > 0) {
            recentMessages.innerHTML = data.data.map(msg => `
                <div class="message-item">
                    <div class="message-avatar">${msg.is_from_me ? '📤' : '📩'}</div>
                    <div class="message-content">
                        <div class="message-sender">${msg.from_name || msg.from_number || 'Unknown'}</div>
                        <div class="message-text">${msg.body?.substring(0, 50) || '-'}${msg.body?.length > 50 ? '...' : ''}</div>
                    </div>
                    <div class="message-time">${formatTime(msg.timestamp)}</div>
                </div>
            `).join('');
        } else {
            recentMessages.innerHTML = `
                <div class="empty-state">
                    <span>📭</span>
                    <p>لا توجد رسائل حتى الآن</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading recent messages:', error);
    }
}

async function syncContacts() {
    syncContactsBtn.disabled = true;
    syncContactsBtn.innerHTML = '<span class="icon">⏳</span><span>جاري المزامنة...</span>';

    try {
        const response = await fetch('/api/contacts/sync', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showToast(data.message, 'success');
            loadDashboardData();
        } else {
            showToast(data.error || 'فشل في المزامنة', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ في المزامنة', 'error');
    } finally {
        syncContactsBtn.disabled = false;
        syncContactsBtn.innerHTML = '<span class="icon">🔄</span><span>مزامنة جهات الاتصال</span>';
    }
}

function formatTime(timestamp) {
    if (!timestamp) return '-';
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
