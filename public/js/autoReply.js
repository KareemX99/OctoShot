/**
 * Auto-Reply Page JavaScript
 */

const socket = io();

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const rulesContainer = document.getElementById('rulesContainer');
const addRuleBtn = document.getElementById('addRuleBtn');
const addRuleBtnEmpty = document.getElementById('addRuleBtnEmpty');
const ruleModal = document.getElementById('ruleModal');
const closeModal = document.getElementById('closeModal');
const cancelRule = document.getElementById('cancelRule');
const saveRule = document.getElementById('saveRule');
const modalTitle = document.getElementById('modalTitle');
const ruleId = document.getElementById('ruleId');
const triggerWord = document.getElementById('triggerWord');
const matchType = document.getElementById('matchType');
const matchHint = document.getElementById('matchHint');
const replyMessage = document.getElementById('replyMessage');
const isActive = document.getElementById('isActive');
const themeToggle = document.getElementById('themeToggle');
const toastContainer = document.getElementById('toastContainer');

// Match type hints
const matchHints = {
    'contains': 'سيتم الرد إذا احتوت الرسالة على الكلمة المفتاحية',
    'exact': 'سيتم الرد إذا كانت الرسالة مطابقة تماماً للكلمة المفتاحية',
    'starts': 'سيتم الرد إذا بدأت الرسالة بالكلمة المفتاحية',
    'ends': 'سيتم الرد إذا انتهت الرسالة بالكلمة المفتاحية'
};

// State
let rules = [];
let editingId = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadRules();
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

    // Add rule buttons
    addRuleBtn.addEventListener('click', openAddModal);
    if (addRuleBtnEmpty) {
        addRuleBtnEmpty.addEventListener('click', openAddModal);
    }

    // Modal controls
    closeModal.addEventListener('click', closeRuleModal);
    cancelRule.addEventListener('click', closeRuleModal);
    saveRule.addEventListener('click', handleSaveRule);

    // Match type change
    matchType.addEventListener('change', () => {
        matchHint.textContent = matchHints[matchType.value];
    });
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

async function loadRules() {
    try {
        const response = await fetch('/api/auto-replies');
        const data = await response.json();

        if (data.success) {
            rules = data.data;
            renderRules();
        }
    } catch (error) {
        console.error('Error loading rules:', error);
    }
}

function renderRules() {
    if (rules.length === 0) {
        rulesContainer.innerHTML = `
            <div class="empty-state">
                <span>🤖</span>
                <p>لا توجد قواعد رد تلقائي</p>
                <button class="btn btn-primary" onclick="openAddModal()">إضافة قاعدة جديدة</button>
            </div>
        `;
        return;
    }

    rulesContainer.innerHTML = rules.map(rule => `
        <div class="rule-card ${!rule.is_active ? 'inactive' : ''}" data-id="${rule.id}">
            <div class="rule-info">
                <div class="rule-trigger">
                    <span class="keyword">${rule.trigger_word}</span>
                    <span class="match-type">${getMatchTypeLabel(rule.match_type)}</span>
                    ${!rule.is_active ? '<span class="badge badge-secondary">معطل</span>' : ''}
                </div>
                <div class="rule-message">${rule.reply_message}</div>
                ${rule.reply_count > 0 ? `<small style="color: var(--text-muted);">تم الرد ${rule.reply_count} مرة</small>` : ''}
            </div>
            <div class="rule-actions">
                <button onclick="toggleRule(${rule.id})" title="${rule.is_active ? 'تعطيل' : 'تفعيل'}">
                    ${rule.is_active ? '⏸️' : '▶️'}
                </button>
                <button onclick="editRule(${rule.id})" title="تعديل">✏️</button>
                <button onclick="deleteRule(${rule.id})" title="حذف">🗑️</button>
            </div>
        </div>
    `).join('');
}

function getMatchTypeLabel(type) {
    const labels = {
        'contains': 'يحتوي على',
        'exact': 'تطابق تام',
        'starts': 'يبدأ بـ',
        'ends': 'ينتهي بـ'
    };
    return labels[type] || type;
}

function openAddModal() {
    editingId = null;
    modalTitle.textContent = 'إضافة قاعدة جديدة';
    ruleId.value = '';
    triggerWord.value = '';
    matchType.value = 'contains';
    matchHint.textContent = matchHints['contains'];
    replyMessage.value = '';
    isActive.checked = true;
    ruleModal.classList.remove('hidden');
}

function editRule(id) {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;

    editingId = id;
    modalTitle.textContent = 'تعديل القاعدة';
    ruleId.value = id;
    triggerWord.value = rule.trigger_word;
    matchType.value = rule.match_type;
    matchHint.textContent = matchHints[rule.match_type];
    replyMessage.value = rule.reply_message;
    isActive.checked = rule.is_active;
    ruleModal.classList.remove('hidden');
}

function closeRuleModal() {
    ruleModal.classList.add('hidden');
    editingId = null;
}

async function handleSaveRule() {
    const data = {
        trigger_word: triggerWord.value.trim(),
        reply_message: replyMessage.value.trim(),
        match_type: matchType.value,
        is_active: isActive.checked
    };

    if (!data.trigger_word || !data.reply_message) {
        showToast('الرجاء ملء جميع الحقول المطلوبة', 'warning');
        return;
    }

    try {
        let response;
        if (editingId) {
            response = await fetch(`/api/auto-replies/${editingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            response = await fetch('/api/auto-replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        const result = await response.json();

        if (result.success) {
            showToast(editingId ? 'تم التعديل بنجاح' : 'تم الإضافة بنجاح', 'success');
            closeRuleModal();
            loadRules();
        } else {
            showToast(result.error || 'حدث خطأ', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ في الحفظ', 'error');
    }
}

async function toggleRule(id) {
    try {
        const response = await fetch(`/api/auto-replies/${id}/toggle`, { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showToast(data.data.is_active ? 'تم التفعيل' : 'تم التعطيل', 'success');
            loadRules();
        } else {
            showToast(data.error || 'حدث خطأ', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ', 'error');
    }
}

async function deleteRule(id) {
    if (!confirm('هل تريد حذف هذه القاعدة؟')) return;

    try {
        const response = await fetch(`/api/auto-replies/${id}`, { method: 'DELETE' });
        const data = await response.json();

        if (data.success) {
            showToast('تم الحذف', 'success');
            loadRules();
        } else {
            showToast(data.error || 'حدث خطأ', 'error');
        }
    } catch (error) {
        showToast('حدث خطأ', 'error');
    }
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
window.openAddModal = openAddModal;
window.editRule = editRule;
window.toggleRule = toggleRule;
window.deleteRule = deleteRule;
