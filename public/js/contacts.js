/**
 * Contacts Page JavaScript
 */

const socket = io();

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const totalContacts = document.getElementById('totalContacts');
const blockedContacts = document.getElementById('blockedContacts');
const businessContacts = document.getElementById('businessContacts');
const searchInput = document.getElementById('searchInput');
const filterSelect = document.getElementById('filterSelect');
const contactsBody = document.getElementById('contactsBody');
const syncBtn = document.getElementById('syncBtn');
const syncBtnEmpty = document.getElementById('syncBtnEmpty');
const themeToggle = document.getElementById('themeToggle');
const toastContainer = document.getElementById('toastContainer');

// State
let contacts = [];
let currentFilter = 'all';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadContacts();
    loadStats();
    initSocketListeners();
    initEventListeners();
});

function initTheme() {
    const isDark = localStorage.getItem('theme') === 'dark';
    if (isDark) {
        document.body.classList.add('dark-theme');
        themeToggle.querySelector('.theme-icon').textContent = '☀️';
    }
}

function initEventListeners() {
    // Theme toggle
    themeToggle.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-theme');
        themeToggle.querySelector('.theme-icon').textContent = isDark ? '☀️' : '🌙';
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

    // Search
    searchInput.addEventListener('input', handleSearch);

    // Filter
    filterSelect.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderContacts();
    });

    // Sync buttons
    syncBtn.addEventListener('click', syncContacts);
    if (syncBtnEmpty) {
        syncBtnEmpty.addEventListener('click', syncContacts);
    }
}

function initSocketListeners() {
    socket.on('status', (data) => {
        if (data.status === 'connected') {
            connectionBadge.classList.add('connected');
            connectionBadge.querySelector('.status-text').textContent = 'متصل';
        } else {
            connectionBadge.classList.remove('connected');
            connectionBadge.querySelector('.status-text').textContent = 'غير متصل';
        }
    });
}

async function loadContacts() {
    try {
        const response = await fetch('/api/contacts');
        const data = await response.json();

        if (data.success) {
            contacts = data.data;
            renderContacts();
        }
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/contacts/stats');
        const data = await response.json();

        if (data.success) {
            totalContacts.textContent = data.data.total || 0;
            blockedContacts.textContent = data.data.blocked || 0;
            businessContacts.textContent = data.data.business || 0;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function handleSearch() {
    const query = searchInput.value.toLowerCase();
    renderContacts(query);
}

function renderContacts(searchQuery = '') {
    let filtered = contacts;

    // Apply filter
    if (currentFilter === 'blocked') {
        filtered = filtered.filter(c => c.is_blocked);
    } else if (currentFilter === 'business') {
        filtered = filtered.filter(c => c.is_business);
    }

    // Apply search
    if (searchQuery) {
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(searchQuery) ||
            (c.push_name || '').toLowerCase().includes(searchQuery) ||
            (c.phone_number || '').includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        contactsBody.innerHTML = `
            <tr class="empty-row">
                <td colspan="5">
                    <div class="empty-state">
                        <span>👥</span>
                        <p>لا توجد جهات اتصال</p>
                        <button class="btn btn-primary" onclick="syncContacts()">مزامنة الآن</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    contactsBody.innerHTML = filtered.map(contact => `
        <tr>
            <td>
                <div class="contact-name">
                    <strong>${contact.name || contact.push_name || '-'}</strong>
                    ${contact.push_name && contact.name ? `<small>${contact.push_name}</small>` : ''}
                </div>
            </td>
            <td>${contact.phone_number || '-'}</td>
            <td>
                ${contact.is_business ? '<span class="badge badge-info">نشاط تجاري</span>' : '<span class="badge">شخصي</span>'}
            </td>
            <td>
                ${contact.is_blocked ? '<span class="badge badge-danger">محظور</span>' : '<span class="badge badge-success">نشط</span>'}
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-icon" onclick="sendMessage('${contact.phone_number}')" title="إرسال رسالة">💬</button>
                    ${contact.is_blocked ?
            `<button class="btn btn-icon" onclick="unblockContact('${contact.contact_id}')" title="إلغاء الحظر">✅</button>` :
            `<button class="btn btn-icon" onclick="blockContact('${contact.contact_id}')" title="حظر">🚫</button>`
        }
                </div>
            </td>
        </tr>
    `).join('');
}

async function syncContacts() {
    syncBtn.disabled = true;
    syncBtn.textContent = '⏳ جاري المزامنة...';

    try {
        const response = await fetch('/api/contacts/sync', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showToast(data.message, 'success');
            loadContacts();
            loadStats();
        } else {
            showToast(data.error || 'فشل في المزامنة', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ في المزامنة', 'error');
    } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = '🔄 مزامنة';
    }
}

async function blockContact(contactId) {
    if (!confirm('هل تريد حظر هذا الرقم؟')) return;

    try {
        const response = await fetch(`/api/contacts/${contactId}/block`, { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showToast('تم الحظر', 'success');
            loadContacts();
            loadStats();
        } else {
            showToast(data.error || 'فشل في الحظر', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ', 'error');
    }
}

async function unblockContact(contactId) {
    try {
        const response = await fetch(`/api/contacts/${contactId}/unblock`, { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showToast('تم إلغاء الحظر', 'success');
            loadContacts();
            loadStats();
        } else {
            showToast(data.error || 'فشل في إلغاء الحظر', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ', 'error');
    }
}

function sendMessage(phoneNumber) {
    window.location.href = `/chats?number=${phoneNumber}`;
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

// Make functions globally accessible
window.syncContacts = syncContacts;
window.blockContact = blockContact;
window.unblockContact = unblockContact;
window.sendMessage = sendMessage;
