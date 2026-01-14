/**
 * Home Page (Link Device) JavaScript
 */

const socket = io();

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const qrContainer = document.getElementById('qrContainer');
const qrPlaceholder = document.getElementById('qrPlaceholder');
const qrCodeDiv = document.getElementById('qrCodeDiv');
const connectedInfo = document.getElementById('connectedInfo');
const connectedName = document.getElementById('connectedName');
const logoutBtn = document.getElementById('logoutBtn');
const messageForm = document.getElementById('messageForm');
const phoneNumber = document.getElementById('phoneNumber');
const messageText = document.getElementById('messageText');
const sendBtn = document.getElementById('sendBtn');
const themeToggle = document.getElementById('themeToggle');
const toastContainer = document.getElementById('toastContainer');

// QR Code instance
let qrCodeInstance = null;

// Theme
let isDarkTheme = localStorage.getItem('theme') === 'dark';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSocketListeners();
    initEventListeners();
    checkStatus();
});

function initTheme() {
    if (isDarkTheme) {
        document.body.classList.add('dark-theme');
        if (themeToggle) {
            themeToggle.querySelector('.theme-icon').textContent = '☀️';
        }
    }
}

function initEventListeners() {
    // Theme toggle
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            isDarkTheme = !isDarkTheme;
            document.body.classList.toggle('dark-theme');
            themeToggle.querySelector('.theme-icon').textContent = isDarkTheme ? '☀️' : '🌙';
            localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
        });
    }

    // Message form
    if (messageForm) {
        messageForm.addEventListener('submit', handleSendMessage);
    }

    // Logout
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

function initSocketListeners() {
    socket.on('qr', (qrData) => {
        console.log('📱 QR Code received');
        showQRCode(qrData);
    });

    socket.on('status', (data) => {
        console.log('📊 Status:', data.status);
        updateConnectionStatus(data.status);
    });

    socket.on('ready', (data) => {
        console.log('✅ Connected:', data);
        updateConnectionStatus('connected');
        hideQRCode();
        if (data.info) {
            showConnectedInfo(data.info);
        }
    });

    socket.on('loading', (data) => {
        if (qrPlaceholder) {
            qrPlaceholder.innerHTML = `
                <div class="spinner"></div>
                <p>جاري التحميل... ${data.percent}%</p>
            `;
        }
    });
}

async function checkStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();

        if (data.connected) {
            updateConnectionStatus('connected');
            hideQRCode();
            showConnectedInfo(data.info);
        } else if (data.qrCode) {
            showQRCode(data.qrCode);
        }
    } catch (error) {
        console.error('Error checking status:', error);
    }
}

function updateConnectionStatus(status) {
    if (!connectionBadge) return;

    const statusText = connectionBadge.querySelector('.status-text');

    const statusMessages = {
        'disconnected': 'غير متصل',
        'qr': 'في انتظار المسح',
        'authenticated': 'جاري الاتصال...',
        'connected': 'متصل',
        'auth_failure': 'فشل المصادقة'
    };

    if (statusText) {
        statusText.textContent = statusMessages[status] || 'غير متصل';
    }

    if (status === 'connected') {
        connectionBadge.classList.add('connected');
    } else {
        connectionBadge.classList.remove('connected');
    }
}

function showQRCode(qrData) {
    if (!qrCodeDiv || !qrContainer) return;

    // Clear previous QR code
    qrCodeDiv.innerHTML = '';

    // Always use dark colors on white background for QR visibility
    const darkColor = '#2c3e50';
    const lightColor = '#ffffff';

    try {
        // Create QR code
        qrCodeInstance = new QRCode(qrCodeDiv, {
            text: qrData,
            width: 220,
            height: 220,
            colorDark: darkColor,
            colorLight: lightColor,
            correctLevel: QRCode.CorrectLevel.H
        });

        // Show QR code
        qrContainer.classList.add('has-qr');
        updateConnectionStatus('qr');
        console.log('✅ QR Code rendered');
    } catch (error) {
        console.error('Error rendering QR code:', error);
    }
}

function hideQRCode() {
    if (qrContainer) {
        qrContainer.classList.remove('has-qr');
    }
    if (qrCodeDiv) {
        qrCodeDiv.innerHTML = '';
    }
    if (qrPlaceholder) {
        qrPlaceholder.innerHTML = `
            <span style="font-size: 3rem;">✅</span>
            <p>متصل بنجاح!</p>
        `;
    }
}

function showConnectedInfo(info) {
    if (connectedInfo) {
        connectedInfo.classList.add('visible');
    }
    if (connectedName) {
        connectedName.textContent = info?.pushname || info?.wid?.user || '-';
    }
}

async function handleSendMessage(e) {
    e.preventDefault();

    const number = phoneNumber.value.trim();
    const message = messageText.value.trim();

    if (!number || !message) {
        showToast('الرجاء ملء جميع الحقول', 'warning');
        return;
    }

    sendBtn.disabled = true;
    const originalContent = sendBtn.innerHTML;
    sendBtn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;"></span> جاري الإرسال...';

    try {
        const response = await fetch('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: number, message })
        });

        const data = await response.json();

        if (data.success) {
            showToast('تم إرسال الرسالة بنجاح! ✅', 'success');
            messageText.value = '';
        } else {
            showToast(data.error || 'فشل في إرسال الرسالة', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ في الاتصال', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = originalContent;
    }
}

async function handleLogout() {
    if (!confirm('هل تريد تسجيل الخروج؟')) return;

    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showToast('تم تسجيل الخروج', 'success');
            if (connectedInfo) {
                connectedInfo.classList.remove('visible');
            }
            if (qrContainer) {
                qrContainer.classList.remove('has-qr');
            }
            if (qrPlaceholder) {
                qrPlaceholder.innerHTML = `
                    <div class="spinner"></div>
                    <p>جاري تحميل الكود...</p>
                `;
            }
            updateConnectionStatus('disconnected');
        }
    } catch (error) {
        showToast('حدث خطأ', 'error');
    }
}

function showToast(message, type = 'success') {
    if (!toastContainer) return;

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
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
