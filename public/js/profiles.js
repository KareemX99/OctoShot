/**
 * Profiles Page JavaScript
 * WhatsApp Profile management functionality
 */

// State
let profiles = [];
let currentProfileId = null;
let socket = null;

// DOM Elements
const profilesTableBody = document.getElementById('profilesTableBody');
const deviceCount = document.getElementById('deviceCount');
const searchInput = document.getElementById('searchInput');
const emptyState = document.getElementById('emptyState');
const tableContainer = document.querySelector('.table-container');

// Modals
const deviceModal = document.getElementById('deviceModal');
const qrModal = document.getElementById('qrModal');
const detailsModal = document.getElementById('detailsModal');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    loadProfiles();
    setupEventListeners();
    setupTheme();
});

/**
 * Initialize Socket.IO connection
 */
function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('🔌 Connected to server');
    });

    socket.on('qr', (data) => {
        console.log('📱 QR received for profile:', data.profileId);
        if (data.profileId === currentProfileId) {
            showQRCode(data.qrCode);
        }
    });

    // Close modal immediately when authenticated (before backup)
    socket.on('authenticated', (data) => {
        console.log('🔐 Profile authenticated:', data.profileId);
        if (data.profileId === currentProfileId) {
            showConnected(data.info || { phoneNumber: 'جاري التحميل...' });
        }
    });

    socket.on('ready', (data) => {
        console.log('✅ Profile ready:', data.profileId);
        if (data.profileId === currentProfileId) {
            showConnected(data.info);
        }
        loadProfiles(); // Refresh list
    });

    socket.on('status', (data) => {
        console.log('📊 Status update:', data);
        updateProfileStatus(data.profileId, data.status);
    });

    socket.on('disconnected', (data) => {
        console.log('❌ Profile disconnected:', data.profileId);
        loadProfiles();
    });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Add Device button
    document.getElementById('addDeviceBtn').addEventListener('click', openAddModal);

    // How to connect button
    document.getElementById('howToConnectBtn').addEventListener('click', () => {
        showToast('امسح QR Code باستخدام واتساب على هاتفك للربط', 'info');
    });

    // Device form submit
    document.getElementById('deviceForm').addEventListener('submit', handleFormSubmit);

    // Search
    searchInput.addEventListener('input', debounce(handleSearch, 300));

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

/**
 * Load profiles from API
 */
async function loadProfiles(search = '') {
    try {
        const url = search ? `/api/profiles?search=${encodeURIComponent(search)}` : '/api/profiles';
        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            profiles = data.data;
            renderProfiles();
            deviceCount.textContent = data.count;
        }
    } catch (error) {
        console.error('Error loading profiles:', error);
        showToast('خطأ في تحميل الأجهزة', 'error');
    }
}

/**
 * Render profiles table
 */
function renderProfiles() {
    if (profiles.length === 0) {
        tableContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    tableContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');

    profilesTableBody.innerHTML = profiles.map(profile => `
        <tr data-id="${profile.id}">
            <td class="uuid-cell">${profile.uuid || '-'}</td>
            <td>${profile.device_name || profile.name || '-'}</td>
            <td>${profile.phone_number || '-'}</td>
            <td>${getStatusBadge(profile.status)}</td>
            <td>${getTrustBadge(profile.trust_level || 1)}</td>
            <td>${getUsageLevelBadge(profile)}</td>
            <td class="webhook-cell">${profile.webhook_url || ''}</td>
            <td>
                <div class="actions-cell">
                    ${profile.status !== 'connected' ? `
                        <button class="action-btn connect" onclick="connectProfileWithCheck(${profile.id})" title="Connect">
                            📱
                        </button>
                        ${profile.status === 'disconnected' && profile.questionnaire_completed ? `
                            <button class="action-btn report-ban" onclick="reportBan(${profile.id})" title="Report Ban">
                                🚫
                            </button>
                        ` : ''}
                    ` : `
                        <button class="action-btn disconnect" onclick="openDisconnectModal(${profile.id})" title="Disconnect">
                            🔌
                        </button>
                    `}
                    <button class="action-btn details" onclick="openDetails(${profile.id})" title="Details">
                        👁️
                    </button>
                    <button class="action-btn edit" onclick="openEditModal(${profile.id})" title="Edit">
                        ✏️
                    </button>
                    <button class="action-btn copy" onclick="copyUUID('${profile.uuid}')" title="Copy UUID">
                        📋
                    </button>
                    <button class="action-btn delete" onclick="deleteProfile(${profile.id})" title="Delete">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status) {
    const badges = {
        'connected': '<span class="status-badge status-connected">متصل</span>',
        'disconnected': '<span class="status-badge status-disconnected">غير متصل</span>',
        'qr': '<span class="status-badge status-connecting">في انتظار QR</span>',
        'initializing': '<span class="status-badge status-connecting">جاري التهيئة...</span>',
        'authenticated': '<span class="status-badge status-connecting">تم المصادقة</span>',
        'error': '<span class="status-badge status-error">خطأ</span>',
        'auth_failure': '<span class="status-badge status-error">فشل المصادقة</span>'
    };
    return badges[status] || badges['disconnected'];
}

/**
 * Get trust level badge HTML
 */
function getTrustBadge(level) {
    const badges = {
        1: '<span class="trust-badge trust-warning" title="جهاز جديد - محدود">⚠️ المستوى 1</span>',
        2: '<span class="trust-badge trust-normal" title="عادي">🟢 المستوى 2</span>',
        3: '<span class="trust-badge trust-good" title="جيد">✨ المستوى 3</span>',
        4: '<span class="trust-badge trust-excellent" title="ممتاز">🌟 المستوى 4</span>'
    };
    return badges[level] || badges[1];
}

/**
 * Update profile status in table
 */
function updateProfileStatus(profileId, status) {
    const row = profilesTableBody.querySelector(`tr[data-id="${profileId}"]`);
    if (row) {
        const statusCell = row.querySelector('td:nth-child(4)');
        if (statusCell) {
            statusCell.innerHTML = getStatusBadge(status);
        }
    }
}

/**
 * Open add device modal
 */
function openAddModal() {
    document.getElementById('modalTitle').textContent = 'إضافة جهاز جديد';
    document.getElementById('deviceForm').reset();
    document.getElementById('deviceId').value = '';
    document.getElementById('saveBtn').textContent = 'حفظ الجهاز';

    // Hide webhook tabs section for new devices
    document.getElementById('webhookTabsSection').style.display = 'none';
    currentWebhooks = [];
    currentNoReplyWebhooks = [];

    deviceModal.classList.remove('hidden');
}

/**
 * Open edit device modal
 */
function openEditModal(id) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    currentProfileId = id;

    document.getElementById('modalTitle').textContent = 'تعديل الجهاز';
    document.getElementById('deviceId').value = id;
    document.getElementById('deviceName').value = profile.device_name || '';
    document.getElementById('webhookUrl').value = profile.webhook_url || '';
    document.getElementById('timezone').value = profile.timezone || 'Africa/Cairo';
    document.getElementById('saveBtn').textContent = 'تحديث الجهاز';

    // Show webhook tabs section and load both webhook types
    document.getElementById('webhookTabsSection').style.display = 'block';
    loadUnreadWebhooks(id);
    loadNoReplyWebhooks(id);

    // Reset to first tab
    switchWebhookTab('unread');

    deviceModal.classList.remove('hidden');
}

/**
 * Close modal
 */
function closeModal() {
    deviceModal.classList.add('hidden');
}

/**
 * Handle form submit
 */
async function handleFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('deviceId').value;
    const data = {
        device_name: document.getElementById('deviceName').value,
        webhook_url: document.getElementById('webhookUrl').value || null,
        timezone: document.getElementById('timezone').value
    };

    try {
        const url = id ? `/api/profiles/${id}` : '/api/profiles';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            showToast(id ? 'تم تحديث الجهاز بنجاح' : 'تم إنشاء الجهاز بنجاح', 'success');
            closeModal();
            loadProfiles();

            // If new device, show questionnaire first then connect
            if (!id && result.data) {
                setTimeout(() => {
                    // Open questionnaire for the new profile - must complete before QR code
                    questionnaireProfileId = result.data.id;
                    proceedToConnect = true; // After questionnaire, will ask to connect
                    openQuestionnaireModal();
                    showToast('يرجى ملء استبيان الاستخدام أولاً', 'info');
                }, 500);
            }
        } else {
            showToast(result.error || 'خطأ في حفظ الجهاز', 'error');
        }
    } catch (error) {
        console.error('Error saving device:', error);
        showToast('خطأ في حفظ الجهاز', 'error');
    }
}

/**
 * Connect profile
 */
async function connectProfile(id) {
    currentProfileId = id;
    qrModal.classList.remove('hidden');

    document.getElementById('qrLoading').classList.remove('hidden');
    document.getElementById('qrDisplay').classList.add('hidden');
    document.getElementById('qrConnected').classList.add('hidden');

    try {
        const response = await fetch(`/api/profiles/${id}/connect`, {
            method: 'POST'
        });
        const data = await response.json();

        if (!data.success) {
            showToast(data.error || 'فشل في الاتصال', 'error');
            closeQRModal();
        }
    } catch (error) {
        console.error('Error connecting:', error);
        showToast('خطأ في ربط الجهاز', 'error');
        closeQRModal();
    }
}

/**
 * Show QR code
 */
function showQRCode(qrDataUrl) {
    document.getElementById('qrLoading').classList.add('hidden');
    document.getElementById('qrDisplay').classList.remove('hidden');
    document.getElementById('qrImage').src = qrDataUrl;
}

/**
 * Show connected state
 */
function showConnected(info) {
    document.getElementById('qrLoading').classList.add('hidden');
    document.getElementById('qrDisplay').classList.add('hidden');
    document.getElementById('qrConnected').classList.remove('hidden');
    document.getElementById('connectedPhone').textContent = info?.wid?.user || 'Connected';

    setTimeout(() => {
        closeQRModal();
        showToast('تم ربط الجهاز بنجاح!', 'success');
    }, 2000);
}

/**
 * Close QR modal
 */
function closeQRModal() {
    qrModal.classList.add('hidden');
    currentProfileId = null;
}

/**
 * Open details modal
 */
function openDetails(id) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    currentProfileId = id;

    document.getElementById('detailUUID').textContent = profile.uuid || '-';
    document.getElementById('detailAPIKey').textContent = profile.api_key || '-';
    document.getElementById('detailDeviceName').textContent = profile.device_name || '-';
    document.getElementById('detailPhone').textContent = profile.phone_number || '-';
    document.getElementById('detailStatus').innerHTML = getStatusBadge(profile.status);
    document.getElementById('detailWebhook').textContent = profile.webhook_url || '-';

    detailsModal.classList.remove('hidden');
}

/**
 * Close details modal
 */
function closeDetailsModal() {
    detailsModal.classList.add('hidden');
    currentProfileId = null;
}

/**
 * Regenerate API key
 */
async function regenerateAPIKey() {
    if (!currentProfileId) return;

    if (!confirm('هل أنت متأكد من تجديد مفتاح API؟ المفتاح القديم سيتوقف عن العمل.')) {
        return;
    }

    try {
        const response = await fetch(`/api/profiles/${currentProfileId}/regenerate-key`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            document.getElementById('detailAPIKey').textContent = data.data.api_key;
            showToast('تم تجديد مفتاح API بنجاح', 'success');
            loadProfiles();
        } else {
            showToast(data.error || 'خطأ في تجديد مفتاح API', 'error');
        }
    } catch (error) {
        console.error('Error regenerating API key:', error);
        showToast('خطأ في تجديد مفتاح API', 'error');
    }
}

/**
 * Delete profile
 */
async function deleteProfile(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الجهاز؟ لا يمكن التراجع عن هذا الإجراء.')) {
        return;
    }

    try {
        const response = await fetch(`/api/profiles/${id}`, {
            method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
            showToast('تم حذف الجهاز بنجاح', 'success');
            loadProfiles();
        } else {
            showToast(data.error || 'خطأ في حذف الجهاز', 'error');
        }
    } catch (error) {
        console.error('Error deleting device:', error);
        showToast('خطأ في حذف الجهاز', 'error');
    }
}

/**
 * Copy UUID to clipboard
 */
function copyUUID(uuid) {
    copyToClipboard(uuid);
}

/**
 * Copy to clipboard
 */
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('تم النسخ!', 'success');
    }).catch(() => {
        // Fallback
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('تم النسخ!', 'success');
    });
}

/**
 * Handle search
 */
function handleSearch(e) {
    loadProfiles(e.target.value);
}

/**
 * Setup theme
 */
function setupTheme() {
    const isDark = localStorage.getItem('darkMode') === 'true';
    if (isDark) {
        document.body.classList.add('dark-mode');
        document.getElementById('themeToggle').innerHTML = `
            <span class="theme-icon">☀️</span>
            <span class="theme-text">الوضع النهاري</span>
        `;
    }
}

/**
 * Toggle theme
 */
function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark);

    document.getElementById('themeToggle').innerHTML = isDark ? `
        <span class="theme-icon">☀️</span>
        <span class="theme-text">الوضع النهاري</span>
    ` : `
        <span class="theme-icon">🌙</span>
        <span class="theme-text">الوضع الليلي</span>
    `;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Get Arabic unit name
 */
function getArabicUnit(unit) {
    const units = {
        'minutes': 'دقيقة',
        'hours': 'ساعة',
        'days': 'يوم'
    };
    return units[unit] || unit;
}

// ============================================
// UNREAD WEBHOOKS
// ============================================

let currentWebhooks = [];

/**
 * Load unread webhooks for a profile
 */
async function loadUnreadWebhooks(profileId) {
    try {
        const response = await fetch(`/api/profiles/${profileId}/unread-webhooks`);
        const data = await response.json();

        if (data.success) {
            currentWebhooks = data.data;
            renderWebhooks();
            updateWebhookCount();
        }
    } catch (error) {
        console.error('Error loading webhooks:', error);
    }
}

/**
 * Render webhooks list
 */
function renderWebhooks() {
    const container = document.getElementById('unreadWebhooksList');

    if (currentWebhooks.length === 0) {
        container.innerHTML = '<p style="color: #64748b; font-size: 0.85rem; text-align: center;">لا يوجد webhooks بعد</p>';
        return;
    }

    container.innerHTML = currentWebhooks.map(webhook => `
        <div class="webhook-card" data-id="${webhook.id}">
            <div class="webhook-info">
                <div class="webhook-url" title="${webhook.webhook_url}">${webhook.webhook_url}</div>
                <div class="webhook-timer">⏱️ بعد ${webhook.timer_value} ${getArabicUnit(webhook.timer_unit)}</div>
            </div>
            <button type="button" class="webhook-delete-btn" onclick="deleteUnreadWebhook(${webhook.id})">🗑️ حذف</button>
        </div>
    `).join('');
}

/**
 * Update webhook count display
 */
function updateWebhookCount() {
    document.getElementById('unreadWebhookCount').textContent = currentWebhooks.length;

    // Disable add if at max
    const addBtn = document.querySelector('#unreadTab .add-webhook-form button');
    if (currentWebhooks.length >= 5) {
        addBtn.disabled = true;
        addBtn.textContent = 'اكتمل الحد';
    } else {
        addBtn.disabled = false;
        addBtn.textContent = '+ إضافة';
    }
}

/**
 * Add a new unread webhook
 */
async function addUnreadWebhook() {
    const url = document.getElementById('newUnreadWebhookUrl').value.trim();
    const timer = document.getElementById('newUnreadWebhookTimer').value;
    const unit = document.getElementById('newUnreadWebhookUnit').value;

    if (!url) {
        showToast('يرجى إدخال رابط Webhook', 'error');
        return;
    }

    if (!timer || timer < 1) {
        showToast('يرجى إدخال قيمة مؤقت صحيحة', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/profiles/${currentProfileId}/unread-webhooks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                webhook_url: url,
                timer_value: parseInt(timer),
                timer_unit: unit
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('تم إضافة Webhook بنجاح', 'success');

            // Clear inputs
            document.getElementById('newUnreadWebhookUrl').value = '';
            document.getElementById('newUnreadWebhookTimer').value = '';

            // Reload webhooks
            await loadUnreadWebhooks(currentProfileId);
        } else {
            showToast(data.error || 'فشل في إضافة Webhook', 'error');
        }
    } catch (error) {
        showToast('خطأ في إضافة Webhook', 'error');
    }
}

/**
 * Delete an unread webhook
 */
async function deleteUnreadWebhook(webhookId) {
    console.log('🗑️ Delete webhook clicked, webhookId:', webhookId, 'currentProfileId:', currentProfileId);

    if (!currentProfileId) {
        showToast('خطأ: لم يتم تحديد الجهاز', 'error');
        console.error('currentProfileId is null or undefined');
        return;
    }

    if (!confirm('هل أنت متأكد من حذف هذا الـ Webhook؟')) {
        return;
    }

    try {
        const url = `/api/profiles/${currentProfileId}/unread-webhooks/${webhookId}`;
        console.log('🗑️ Deleting webhook at:', url);

        const response = await fetch(url, {
            method: 'DELETE'
        });

        const data = await response.json();
        console.log('🗑️ Delete response:', data);

        if (data.success) {
            showToast('تم حذف Webhook', 'success');
            await loadUnreadWebhooks(currentProfileId);
        } else {
            showToast(data.error || 'فشل في حذف Webhook', 'error');
        }
    } catch (error) {
        console.error('Error deleting webhook:', error);
        showToast('خطأ في حذف Webhook', 'error');
    }
}

// ============================================
// TAB SWITCHING
// ============================================

/**
 * Switch between webhook tabs
 */
function switchWebhookTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.webhook-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        }
    });

    // Update tab contents
    document.querySelectorAll('.webhook-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    if (tabName === 'unread') {
        document.getElementById('unreadTab').classList.add('active');
    } else if (tabName === 'noReply') {
        document.getElementById('noReplyTab').classList.add('active');
    }
}

// ============================================
// READ NO-REPLY WEBHOOKS
// ============================================

let currentNoReplyWebhooks = [];

/**
 * Load read-no-reply webhooks for a profile
 */
async function loadNoReplyWebhooks(profileId) {
    try {
        const response = await fetch(`/api/profiles/${profileId}/read-no-reply-webhooks`);
        const data = await response.json();

        if (data.success) {
            currentNoReplyWebhooks = data.data;
            renderNoReplyWebhooks();
            updateNoReplyWebhookCount();
        }
    } catch (error) {
        console.error('Error loading read-no-reply webhooks:', error);
    }
}

/**
 * Render read-no-reply webhooks list
 */
function renderNoReplyWebhooks() {
    const container = document.getElementById('noReplyWebhooksList');

    if (currentNoReplyWebhooks.length === 0) {
        container.innerHTML = '<p style="color: #64748b; font-size: 0.85rem; text-align: center;">لا يوجد webhooks بعد</p>';
        return;
    }

    container.innerHTML = currentNoReplyWebhooks.map(webhook => `
        <div class="webhook-card" data-id="${webhook.id}">
            <div class="webhook-info">
                <div class="webhook-url" title="${webhook.webhook_url}">${webhook.webhook_url}</div>
                <div class="webhook-timer">👁️ بعد ${webhook.timer_value} ${getArabicUnit(webhook.timer_unit)} من القراءة</div>
            </div>
            <button type="button" class="webhook-delete-btn" onclick="deleteNoReplyWebhook(${webhook.id})">🗑️ حذف</button>
        </div>
    `).join('');
}

/**
 * Update read-no-reply webhook count
 */
function updateNoReplyWebhookCount() {
    document.getElementById('noReplyWebhookCount').textContent = currentNoReplyWebhooks.length;

    const addBtn = document.querySelector('#noReplyTab .add-webhook-form button');
    if (currentNoReplyWebhooks.length >= 5) {
        addBtn.disabled = true;
        addBtn.textContent = 'اكتمل الحد';
    } else {
        addBtn.disabled = false;
        addBtn.textContent = '+ إضافة';
    }
}

/**
 * Add a new read-no-reply webhook
 */
async function addNoReplyWebhook() {
    const url = document.getElementById('newNoReplyWebhookUrl').value.trim();
    const timer = document.getElementById('newNoReplyWebhookTimer').value;
    const unit = document.getElementById('newNoReplyWebhookUnit').value;

    if (!url) {
        showToast('يرجى إدخال رابط Webhook', 'error');
        return;
    }

    if (!timer || timer < 1) {
        showToast('يرجى إدخال قيمة مؤقت صحيحة', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/profiles/${currentProfileId}/read-no-reply-webhooks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                webhook_url: url,
                timer_value: parseInt(timer),
                timer_unit: unit
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('تم إضافة Webhook بنجاح', 'success');

            // Clear inputs
            document.getElementById('newNoReplyWebhookUrl').value = '';
            document.getElementById('newNoReplyWebhookTimer').value = '';

            // Reload webhooks
            await loadNoReplyWebhooks(currentProfileId);
        } else {
            showToast(data.error || 'فشل في إضافة Webhook', 'error');
        }
    } catch (error) {
        showToast('خطأ في إضافة Webhook', 'error');
    }
}

/**
 * Delete a read-no-reply webhook
 */
async function deleteNoReplyWebhook(webhookId) {
    console.log('🗑️ Delete no-reply webhook clicked, webhookId:', webhookId, 'currentProfileId:', currentProfileId);

    if (!currentProfileId) {
        showToast('خطأ: لم يتم تحديد الجهاز', 'error');
        console.error('currentProfileId is null or undefined');
        return;
    }

    if (!confirm('هل أنت متأكد من حذف هذا الـ Webhook؟')) {
        return;
    }

    try {
        const url = `/api/profiles/${currentProfileId}/read-no-reply-webhooks/${webhookId}`;
        console.log('🗑️ Deleting no-reply webhook at:', url);

        const response = await fetch(url, {
            method: 'DELETE'
        });

        const data = await response.json();
        console.log('🗑️ Delete response:', data);

        if (data.success) {
            showToast('تم حذف Webhook', 'success');
            await loadNoReplyWebhooks(currentProfileId);
        } else {
            showToast(data.error || 'فشل في حذف Webhook', 'error');
        }
    } catch (error) {
        console.error('Error deleting no-reply webhook:', error);
        showToast('خطأ في حذف Webhook', 'error');
    }
}

// ============================================
// DISCONNECT PROFILE
// ============================================

let disconnectTargetId = null;
const disconnectModal = document.getElementById('disconnectModal');

/**
 * Open disconnect confirmation modal
 */
function openDisconnectModal(profileId) {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    disconnectTargetId = profileId;

    // Display profile ID (UUID) that user needs to copy
    document.getElementById('disconnectProfileId').textContent = profile.uuid || profile.id.toString();
    document.getElementById('confirmProfileId').value = '';
    document.getElementById('confirmDisconnectBtn').disabled = true;

    disconnectModal.classList.remove('hidden');
}

/**
 * Close disconnect modal
 */
function closeDisconnectModal() {
    disconnectModal.classList.add('hidden');
    disconnectTargetId = null;
    document.getElementById('confirmProfileId').value = '';
    document.getElementById('confirmDisconnectBtn').disabled = true;
}

/**
 * Copy disconnect profile ID
 */
function copyDisconnectId() {
    const profileId = document.getElementById('disconnectProfileId').textContent;
    copyToClipboard(profileId);
}

/**
 * Validate if pasted ID matches
 */
function validateDisconnectId() {
    const expectedId = document.getElementById('disconnectProfileId').textContent;
    const enteredId = document.getElementById('confirmProfileId').value.trim();

    const isMatch = enteredId === expectedId;
    document.getElementById('confirmDisconnectBtn').disabled = !isMatch;

    // Visual feedback
    const input = document.getElementById('confirmProfileId');
    if (enteredId.length > 0) {
        input.style.borderColor = isMatch ? '#22c55e' : '#ef4444';
    } else {
        input.style.borderColor = '';
    }
}

/**
 * Execute the disconnect
 */
async function executeDisconnect() {
    if (!disconnectTargetId) return;

    const btn = document.getElementById('confirmDisconnectBtn');
    btn.disabled = true;
    btn.innerHTML = '⏳ Disconnecting...';

    try {
        const response = await fetch(`/api/profiles/${disconnectTargetId}/disconnect`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showToast('تم فصل الجهاز ومسح الجلسة بنجاح', 'success');
            closeDisconnectModal();
            loadProfiles(); // Refresh the list
        } else {
            showToast(data.error || 'فشل في فصل الجهاز', 'error');
            btn.disabled = false;
            btn.innerHTML = '🔌 فصل الجهاز';
        }
    } catch (error) {
        console.error('Error disconnecting device:', error);
        showToast('خطأ في فصل الجهاز', 'error');
        btn.disabled = false;
    }
}

// ============================================
// USAGE LEVEL SYSTEM
// ============================================

let questionnaireProfileId = null;
let proceedToConnect = false;

/**
 * Get usage level badge HTML
 */
function getUsageLevelBadge(profile) {
    const level = profile.usage_level || 1;
    const dailyLimit = profile.daily_limit || 50;
    const completed = profile.questionnaire_completed;

    const levelConfig = {
        0: { name: 'ضعيف جداً', color: '#495057', emoji: '⚫' },
        1: { name: 'ضعيف', color: '#ff6b6b', emoji: '🔴' },
        2: { name: 'أقل من المتوسط', color: '#ffa94d', emoji: '🟠' },
        3: { name: 'متوسط', color: '#ffd43b', emoji: '🟡' },
        4: { name: 'جيد', color: '#69db7c', emoji: '🟢' },
        5: { name: 'ممتاز', color: '#4ecdc4', emoji: '🌟' }
    };

    const config = levelConfig[level] || levelConfig[1];

    if (!completed) {
        return `<span class="usage-badge usage-unconfigured" title="يجب ملء الاستبيان" onclick="openQuestionnaireForProfile(${profile.id})">
            ⚙️ إعداد
        </span>`;
    }

    return `<span class="usage-badge" style="background: ${config.color}; color: ${level <= 1 ? '#fff' : '#000'}" title="${config.name}">
        ${config.emoji} ${config.name}
    </span>`;
}

/**
 * Open questionnaire for a specific profile
 */
function openQuestionnaireForProfile(profileId) {
    questionnaireProfileId = profileId;
    proceedToConnect = false;
    openQuestionnaireModal();
}

/**
 * Open questionnaire modal
 */
function openQuestionnaireModal() {
    // Reset form
    const form = document.getElementById('questionnaireForm');
    const radios = form.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => radio.checked = false);

    // Show form, hide result
    form.classList.remove('hidden');
    document.getElementById('questionnaireResult').classList.add('hidden');
    document.getElementById('saveQuestionnaireBtn').disabled = false;
    document.getElementById('saveQuestionnaireBtn').textContent = '💾 حفظ والمتابعة';

    document.getElementById('questionnaireModal').classList.remove('hidden');
}

/**
 * Close questionnaire modal
 */
function closeQuestionnaireModal() {
    document.getElementById('questionnaireModal').classList.add('hidden');
    questionnaireProfileId = null;
    proceedToConnect = false;
}

/**
 * Save questionnaire and determine usage level
 */
async function saveQuestionnaire() {
    const phoneAge = document.querySelector('input[name="phoneAge"]:checked')?.value;
    const dailyMessageRate = document.querySelector('input[name="dailyMessageRate"]:checked')?.value;
    const usedSpamSoftware = document.querySelector('input[name="usedSpamSoftware"]:checked')?.value;
    const previousBan = document.querySelector('input[name="previousBan"]:checked')?.value;

    // Validate all answers
    if (!phoneAge || !dailyMessageRate || !usedSpamSoftware || !previousBan) {
        showToast('يرجى الإجابة على جميع الأسئلة', 'error');
        return;
    }

    const btn = document.getElementById('saveQuestionnaireBtn');
    btn.disabled = true;
    btn.textContent = '⏳ جاري الحفظ...';

    try {
        const response = await fetch(`/api/profiles/${questionnaireProfileId}/usage-questionnaire`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneAge, dailyMessageRate, usedSpamSoftware, previousBan })
        });

        const data = await response.json();

        if (data.success) {
            // Show result
            const result = document.getElementById('questionnaireResult');
            result.querySelector('.result-icon').textContent = data.data.emoji;
            result.querySelector('.result-title').textContent = `المستوى: ${data.data.level_name}`;
            result.querySelector('.result-description').textContent = `الحد الأقصى للإرسال: ${data.data.daily_limit} رسالة/يوم`;
            result.style.borderColor = data.data.color;

            document.getElementById('questionnaireForm').classList.add('hidden');
            result.classList.remove('hidden');

            showToast(data.message, 'success');

            // Refresh profiles list
            loadProfiles();

            // If we need to proceed to connect, do it after a delay
            if (proceedToConnect) {
                btn.textContent = '📱 جاري التوصيل...';
                // IMPORTANT: Save the profile ID before closing modal (which resets it)
                const profileIdToConnect = questionnaireProfileId;
                setTimeout(() => {
                    closeQuestionnaireModal();
                    if (profileIdToConnect) {
                        proceedToQRCode(profileIdToConnect);
                    }
                }, 1500);
            } else {
                btn.textContent = '✅ تم الحفظ';
                setTimeout(() => {
                    closeQuestionnaireModal();
                }, 1500);
            }
        } else {
            showToast(data.error || 'حدث خطأ أثناء الحفظ', 'error');
            btn.disabled = false;
            btn.textContent = '💾 حفظ والمتابعة';
        }
    } catch (error) {
        console.error('Error saving questionnaire:', error);
        showToast('حدث خطأ أثناء الحفظ', 'error');
        btn.disabled = false;
        btn.textContent = '💾 حفظ والمتابعة';
    }
}

/**
 * Check if questionnaire is completed before connecting
 */
async function connectProfileWithCheck(id) {
    const profile = profiles.find(p => p.id === id);

    if (!profile.questionnaire_completed) {
        // Open questionnaire first
        questionnaireProfileId = id;
        proceedToConnect = true;
        openQuestionnaireModal();
        return;
    }

    // Questionnaire completed, proceed to QR
    proceedToQRCode(id);
}

/**
 * Proceed to QR code display (after questionnaire)
 */
function proceedToQRCode(id) {
    currentProfileId = id;
    qrModal.classList.remove('hidden');

    document.getElementById('qrLoading').classList.remove('hidden');
    document.getElementById('qrDisplay').classList.add('hidden');
    document.getElementById('qrConnected').classList.add('hidden');

    fetch(`/api/profiles/${id}/connect`, { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                showToast(data.error || 'فشل في الاتصال', 'error');
                closeQRModal();
            }
        })
        .catch(error => {
            console.error('Error connecting:', error);
            showToast('خطأ في ربط الجهاز', 'error');
            closeQRModal();
        });
}

/**
 * Report ban for a profile
 */
async function reportBan(profileId) {
    if (!confirm('هل أنت متأكد من الإبلاغ عن حظر هذا الرقم؟\nسيتم تخفيض مستوى الاستخدام.')) {
        return;
    }

    try {
        const response = await fetch(`/api/profiles/${profileId}/report-ban`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showToast(`تم تخفيض المستوى إلى ${data.data.level_name}`, 'warning');
            loadProfiles();
        } else {
            showToast(data.error || 'حدث خطأ', 'error');
        }
    } catch (error) {
        console.error('Error reporting ban:', error);
        showToast('حدث خطأ أثناء الإبلاغ', 'error');
    }
}

