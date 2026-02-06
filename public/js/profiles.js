/**
 * Profiles Page JavaScript
 * WhatsApp Profile management functionality
 */

// State
let profiles = [];
let currentProfileId = null;
let socket = null;
let currentFilter = 'all';

// DOM Elements
const devicesGrid = document.getElementById('devicesGrid');
const searchInput = document.getElementById('searchInput');
const emptyState = document.getElementById('emptyState');
const statsSection = document.getElementById('statsSection');

// Modals
const deviceModal = document.getElementById('deviceModal');
const qrModal = document.getElementById('qrModal');
const detailsModal = document.getElementById('detailsModal');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    loadProfiles();
    setupEventListeners();
    // setupTheme(); // Handled by theme.js
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
            updateProgress('scanning');
            updateStatusMessage('في انتظار المسح', 'امسح رمز QR باستخدام تطبيق واتساب على هاتفك');
            showQRCode(data.qrCode);
        }
    });

    // Loading screen event
    socket.on('loading', (data) => {
        console.log('⏳ Loading:', data.percent + '%', data.message);
        if (data.profileId === currentProfileId) {
            if (data.percent < 50) {
                updateProgress('initializing');
                updateStatusMessage('جاري تهيئة الجهاز...', `${data.percent}% - ${data.message || 'جاري تنظيف الملفات المؤقتة...'}`);;
            } else {
                updateProgress('qr');
                updateStatusMessage('جاري إنشاء رمز QR...', `${data.percent}%`);
            }
        }
    });

    // Close modal immediately when authenticated (before backup)
    socket.on('authenticated', (data) => {
        console.log('🔐 Profile authenticated:', data.profileId);
        if (data.profileId === currentProfileId) {
            updateProgress('authenticating');
            updateStatusMessage('جاري المصادقة...', 'يتم التحقق من الاتصال وتهيئة الجلسة');
            // Wait a bit to show the authentication step, then show connected
            setTimeout(() => {
                updateProgress('connected');
                showConnected(data.info || { phoneNumber: 'جاري التحميل...' });
            }, 1500);
        }
    });

    socket.on('ready', (data) => {
        console.log('✅ Profile ready:', data.profileId);
        if (data.profileId === currentProfileId) {
            updateProgress('connected');
            showConnected(data.info);
        }
        // Update local profile's phone number immediately (before loadProfiles)
        if (data.phone_number && data.profileId) {
            const profile = profiles.find(p => p.id === data.profileId);
            if (profile) {
                profile.phone_number = data.phone_number;
                console.log(`📱 Phone updated for profile ${data.profileId}: ${data.phone_number}`);
                renderProfiles(); // Re-render immediately with new phone
            }
        }
        loadProfiles(); // Also refresh from server for complete data
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

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderProfiles();
        });
    });

    // Theme toggle - Handled by theme.js
    // document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

/**
 * Open modal to add a new device
 * Note: This function is defined once and used for both the header button and empty state button
 */
// openAddModal is defined below at line ~428

/**
 * Close device add/edit modal
 */
function closeDeviceModal() {
    deviceModal.classList.add('hidden');
    document.getElementById('deviceForm').reset();
}

/**
 * Handle device form submission (add or edit)
 */
async function handleFormSubmit(e) {
    e.preventDefault();

    const deviceId = document.getElementById('deviceId').value;
    const deviceName = document.getElementById('deviceName').value;
    const timezone = document.getElementById('timezone').value;

    const data = {
        device_name: deviceName,
        timezone: timezone
    };

    try {
        let response;
        if (deviceId) {
            // Edit existing device
            response = await fetch(`/api/profiles/${deviceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            // Add new device
            response = await fetch('/api/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        const result = await response.json();

        if (result.success) {
            showToast(deviceId ? 'تم تحديث الجهاز بنجاح' : 'تم إضافة الجهاز بنجاح', 'success');
            closeDeviceModal();
            loadProfiles();
        } else {
            showToast(result.message || 'حدث خطأ', 'error');
        }
    } catch (error) {
        console.error('Error saving device:', error);
        showToast('خطأ في حفظ الجهاز', 'error');
    }
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
            updateStats();
            renderProfiles();
        }
    } catch (error) {
        console.error('Error loading profiles:', error);
        showToast('خطأ في تحميل الأجهزة', 'error');
    }
}

/**
 * Update stats cards
 */
function updateStats() {
    const total = profiles.length;
    const connected = profiles.filter(p => p.status === 'connected').length;
    const disconnected = total - connected;

    document.getElementById('totalDevices').textContent = total;
    document.getElementById('connectedDevices').textContent = connected;
    document.getElementById('disconnectedDevices').textContent = disconnected;
}

/**
 * Render profiles as cards
 */
function renderProfiles() {
    // Filter profiles
    let filteredProfiles = profiles;
    if (currentFilter === 'connected') {
        filteredProfiles = profiles.filter(p => p.status === 'connected');
    } else if (currentFilter === 'disconnected') {
        filteredProfiles = profiles.filter(p => p.status !== 'connected');
    }

    if (filteredProfiles.length === 0) {
        devicesGrid.innerHTML = '';
        if (profiles.length === 0) {
            statsSection.classList.add('hidden');
            emptyState.classList.remove('hidden');
        } else {
            statsSection.classList.remove('hidden');
            emptyState.classList.add('hidden');
            devicesGrid.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">لا توجد أجهزة تطابق الفلتر المحدد</p>';
        }
        return;
    }

    statsSection.classList.remove('hidden');
    emptyState.classList.add('hidden');

    devicesGrid.innerHTML = filteredProfiles.map(profile => `
        <div class="device-card ${profile.status === 'connected' ? 'connected' : 'disconnected'}" data-id="${profile.id}">
            <div class="device-card-header">
                <div class="device-avatar ${profile.status === 'connected' ? 'connected' : 'disconnected'}">
                    ${getDeviceInitials(profile.device_name || profile.name || 'D')}
                </div>
                <div class="device-info">
                    <div class="device-name">
                        ${profile.device_name || profile.name || 'جهاز غير مسمى'}
                        <span class="device-status ${profile.status === 'connected' ? 'connected' : profile.status === 'qr' || profile.status === 'initializing' ? 'connecting' : 'disconnected'}">
                            ${getStatusText(profile.status)}
                        </span>
                    </div>
                    <div class="device-phone">${profile.phone_number || (profile.status === 'connected' ? 'جاري التحميل...' : 'غير متصل')}</div>
                </div>
            </div>
            <div class="device-card-body">
                <div class="device-meta">
                    <div class="meta-item">
                        <span class="meta-label">المستوى</span>
                        <span class="meta-value">${getTrustBadgeSimple(profile.trust_level || 1)}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">الاستخدام</span>
                        <span class="meta-value">${getUsageBadgeSimple(profile)}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Webhook</span>
                        <span class="meta-value">
                            <span class="webhook-indicator ${profile.webhook_url ? 'active' : 'inactive'}">
                                ${profile.webhook_url ? '✓ مفعل' : '○ غير مفعل'}
                            </span>
                        </span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">UUID</span>
                        <span class="meta-value uuid">${(profile.uuid || '-').substring(0, 8)}...</span>
                    </div>
                </div>
            </div>
            <div class="device-card-footer">
                ${profile.status !== 'connected' ? `
                    <button class="device-action connect" onclick="connectProfileWithCheck(${profile.id})" title="اتصال">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
                            <path d="M12 18h.01"/>
                        </svg>
                        اتصال
                    </button>
                ` : `
                    <button class="device-action disconnect" onclick="openDisconnectModal(${profile.id})" title="قطع الاتصال">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18.36 6.64A9 9 0 0 1 20.77 15"/>
                            <path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/>
                            <path d="M12 2v4"/>
                            <path d="m2 2 20 20"/>
                        </svg>
                        فصل
                    </button>
                `}
                <button class="device-action details" onclick="openDetails(${profile.id})" title="التفاصيل">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
                <button class="device-action edit" onclick="openEditModal(${profile.id})" title="تعديل">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                    </svg>
                </button>
                <button class="device-action webhooks" onclick="openWebhooksModal(${profile.id})" title="إدارة الروابط (Webhooks)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                </button>
                <button class="device-action delete" onclick="deleteProfile(${profile.id})" title="حذف">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18"/>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * Get device initials for avatar
 */
function getDeviceInitials(name) {
    if (!name) return 'D';
    return name.substring(0, 2).toUpperCase();
}

/**
 * Get simple status text
 */
function getStatusText(status) {
    const texts = {
        'connected': 'متصل',
        'disconnected': 'غير متصل',
        'qr': 'في انتظار QR',
        'initializing': 'جاري التهيئة...',
        'authenticated': 'تم المصادقة',
        'error': 'خطأ',
        'auth_failure': 'فشل المصادقة'
    };
    return texts[status] || 'غير متصل';
}

/**
 * Get simple trust badge
 */
function getTrustBadgeSimple(level) {
    const badges = {
        1: '<span class="trust-badge warning">⚠️ المستوى 1</span>',
        2: '<span class="trust-badge normal">✓ المستوى 2</span>',
        3: '<span class="trust-badge good">⭐ المستوى 3</span>',
        4: '<span class="trust-badge excellent">🌟 المستوى 4</span>'
    };
    return badges[level] || badges[1];
}

/**
 * Get simple usage badge
 */
function getUsageBadgeSimple(profile) {
    if (profile.questionnaire_completed) {
        return '<span class="usage-badge configured">✓ مُهيأ</span>';
    }
    return `<span class="usage-badge unconfigured" onclick="openQuestionnaireForProfile(${profile.id})">⚙️ تهيئة</span>`;
}

/**
 * Get status badge HTML (for compatibility)
 */
function getStatusBadge(status) {
    const badges = {
        'connected': '<span class="status-badge status-connected"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> متصل</span>',
        'disconnected': '<span class="status-badge status-disconnected"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> غير متصل</span>',
        'qr': '<span class="status-badge status-connecting"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/></svg> في انتظار QR</span>',
        'initializing': '<span class="status-badge status-connecting"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> جاري التهيئة...</span>',
        'authenticated': '<span class="status-badge status-connecting"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg> تم المصادقة</span>',
        'error': '<span class="status-badge status-error"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg> خطأ</span>',
        'auth_failure': '<span class="status-badge status-error"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg> فشل المصادقة</span>'
    };
    return badges[status] || badges['disconnected'];
}

/**
 * Get trust level badge HTML (for compatibility)
 */
function getTrustBadge(level) {
    const badges = {
        1: '<span class="trust-badge trust-warning" title="جهاز جديد - محدود"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> المستوى 1</span>',
        2: '<span class="trust-badge trust-normal" title="عادي"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> المستوى 2</span>',
        3: '<span class="trust-badge trust-good" title="جيد"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> المستوى 3</span>',
        4: '<span class="trust-badge trust-excellent" title="ممتاز"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> المستوى 4</span>'
    };
    return badges[level] || badges[1];
}

/**
 * Update profile status in card
 */
function updateProfileStatus(profileId, status) {
    const card = devicesGrid.querySelector(`.device-card[data-id="${profileId}"]`);
    if (card) {
        // Re-render on status change
        loadProfiles();
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

    // Hide webhook tabs section for new devices (if exists)
    const webhookTabsSection = document.getElementById('webhookTabsSection');
    if (webhookTabsSection) {
        webhookTabsSection.style.display = 'none';
    }
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
    document.getElementById('timezone').value = profile.timezone || 'Africa/Cairo';
    document.getElementById('saveBtn').textContent = 'تحديث الجهاز';

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

    // Initialize progress tracker
    resetProgress();
    updateProgress('initializing');
    updateStatusMessage('جاري تهيئة الجهاز...', 'يتم بدء عملية الاتصال بخادم واتساب');

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
    document.getElementById('qrDisplay').classList.remove('hidden');
    document.getElementById('qrImage').src = qrDataUrl;
}

/**
 * Show connected state
 */
function showConnected(info) {
    const qrDisplay = document.getElementById('qrDisplay');
    const qrConnected = document.getElementById('qrConnected');
    const connectedPhone = document.getElementById('connectedPhone');

    if (qrDisplay) qrDisplay.classList.add('hidden');
    if (qrConnected) qrConnected.classList.remove('hidden');
    if (connectedPhone) connectedPhone.textContent = info?.wid?.user || 'Connected';

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
/**
 * Copy to clipboard (Generic)
 */
function copyToClipboard(text) {
    if (!text) return;

    // Try modern API
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('تم النسخ!', 'success');
        }).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

/**
 * Fallback copy method
 */
function fallbackCopy(text) {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.focus();
    input.select();
    try {
        document.execCommand('copy');
        showToast('تم النسخ!', 'success');
    } catch (err) {
        console.error('Copy failed:', err);
        showToast('فشل النسخ', 'error');
    }
    document.body.removeChild(input);
}

/**
 * Copy text from element ID (Used by modal)
 */
function copyText(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        // If it's a code block or div, get textContent
        // If it uses .api-key-container, it might have extra whitespace, so trim
        const text = element.textContent.trim();
        copyToClipboard(text);
    }
}

/**
 * Handle search
 */
function handleSearch(e) {
    loadProfiles(e.target.value);
}

/**
 * Theme logic is now handled by theme.js
 */

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
            <div class="webhook-content">
                <div class="webhook-url-box">
                    <span class="url-text" title="${webhook.webhook_url}">${webhook.webhook_url}</span>
                    <button class="btn-copy-mini" onclick="copyToClipboard('${webhook.webhook_url}')" title="نسخ الرابط">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                    </button>
                </div>
                <div class="webhook-meta-row">
                    <span class="timer-badge">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        بعد ${webhook.timer_value} ${getArabicUnit(webhook.timer_unit)}
                    </span>
                    <div class="webhook-direct-toggle">
                        <label class="toggle-switch-small">
                            <input type="checkbox" ${webhook.include_direct_messages ? 'checked' : ''} onchange="toggleDirectMessages(${webhook.id}, this.checked)">
                            <span class="toggle-slider-small"></span>
                        </label>
                        <span class="toggle-label">شامل الرسائل المباشرة</span>
                    </div>
                </div>
            </div>
            <button type="button" class="btn-icon-danger" onclick="deleteUnreadWebhook(${webhook.id})" title="حذف">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
        </div>
    `).join('');
}

/**
 * Update webhook count display
 */
function updateWebhookCount() {
    const countEl = document.getElementById('unreadWebhookCountBadge');
    if (countEl) {
        const count = currentWebhooks.length;
        countEl.textContent = `${count} مفعل`;

        // Dynamic badge styling
        if (count > 0) {
            countEl.style.background = 'rgba(249, 115, 22, 0.15)';
            countEl.style.color = '#f97316';
        } else {
            countEl.style.background = '';
            countEl.style.color = '';
        }
    }

    // Disable add if at max
    const addBtn = document.querySelector('#unreadPanel .btn-add');
    if (addBtn) {
        if (currentWebhooks.length >= 5) {
            addBtn.disabled = true;
            addBtn.querySelector('span').textContent = 'اكتمل الحد';
        } else {
            addBtn.disabled = false;
            addBtn.querySelector('span').textContent = 'إضافة';
        }
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

/**
 * Toggle direct messages mode for a webhook
 */
async function toggleDirectMessages(webhookId, enabled) {
    try {
        const response = await fetch(`/api/profiles/${currentProfileId}/unread-webhooks/${webhookId}/direct-messages`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ include_direct_messages: enabled })
        });

        const data = await response.json();

        if (data.success) {
            showToast(enabled ? 'تم تفعيل رسائل الواتساب المباشرة' : 'تم إلغاء رسائل الواتساب المباشرة', 'success');
            // Update local state
            const webhook = currentWebhooks.find(w => w.id === webhookId);
            if (webhook) {
                webhook.include_direct_messages = enabled;
            }
        } else {
            showToast(data.error || 'فشل في تحديث الإعداد', 'error');
            // Reload to reset checkbox
            await loadUnreadWebhooks(currentProfileId);
        }
    } catch (error) {
        console.error('Error toggling direct messages:', error);
        showToast('خطأ في تحديث الإعداد', 'error');
        await loadUnreadWebhooks(currentProfileId);
    }
}

// ============================================
// TAB SWITCHING
// ============================================

/**
 * Switch between webhook tabs
 */


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
            <div class="webhook-content">
                <div class="webhook-url-box">
                    <span class="url-text" title="${webhook.webhook_url}">${webhook.webhook_url}</span>
                    <button class="btn-copy-mini" onclick="copyToClipboard('${webhook.webhook_url}')" title="نسخ الرابط">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                    </button>
                </div>
                <div class="webhook-meta-row">
                    <span class="timer-badge">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        بعد ${webhook.timer_value} ${getArabicUnit(webhook.timer_unit)} من القراءة
                    </span>
                </div>
            </div>
            <button type="button" class="btn-icon-danger" onclick="deleteNoReplyWebhook(${webhook.id})" title="حذف">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
        </div>
    `).join('');
}

/**
 * Update read-no-reply webhook count
 */
function updateNoReplyWebhookCount() {
    const countEl = document.getElementById('noReplyWebhookCountBadge');
    if (countEl) {
        const count = currentNoReplyWebhooks.length;
        countEl.textContent = `${count} مفعل`;

        // Dynamic badge styling
        if (count > 0) {
            countEl.style.background = 'rgba(16, 185, 129, 0.15)';
            countEl.style.color = '#10b981';
        } else {
            countEl.style.background = '';
            countEl.style.color = '';
        }
    }

    const addBtn = document.querySelector('#noreplyPanel .btn-add');
    if (addBtn) {
        if (currentNoReplyWebhooks.length >= 5) {
            addBtn.disabled = true;
            addBtn.querySelector('span').textContent = 'اكتمل الحد';
        } else {
            addBtn.disabled = false;
            addBtn.querySelector('span').textContent = 'إضافة';
        }
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
// INCOMING UNREPLIED WEBHOOKS (NEW - 4th type)
// ============================================

let currentIncomingUnrepliedWebhooks = [];

/**
 * Load incoming unreplied webhooks for a profile
 */
async function loadIncomingUnrepliedWebhooks(profileId) {
    try {
        const response = await fetch(`/api/profiles/${profileId}/incoming-unreplied-webhooks`);
        const data = await response.json();

        if (data.success) {
            currentIncomingUnrepliedWebhooks = data.data;
            renderIncomingUnrepliedWebhooks();
            updateIncomingUnrepliedWebhookCount();
        }
    } catch (error) {
        console.error('Error loading incoming unreplied webhooks:', error);
    }
}

/**
 * Render incoming unreplied webhooks list
 */
function renderIncomingUnrepliedWebhooks() {
    const container = document.getElementById('incomingUnrepliedWebhooksList');
    if (!container) return;

    if (currentIncomingUnrepliedWebhooks.length === 0) {
        container.innerHTML = '<p style="color: #64748b; font-size: 0.85rem; text-align: center;">لا يوجد webhooks بعد</p>';
        return;
    }

    container.innerHTML = currentIncomingUnrepliedWebhooks.map(webhook => `
        <div class="webhook-card" data-id="${webhook.id}">
            <div class="webhook-content">
                <div class="webhook-url-box">
                    <span class="url-text" title="${webhook.webhook_url}">${webhook.webhook_url}</span>
                    <button class="btn-copy-mini" onclick="copyToClipboard('${webhook.webhook_url}')" title="نسخ الرابط">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                    </button>
                </div>
                <div class="webhook-meta-row">
                    <span class="timer-badge">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        بعد ${webhook.timer_value} ${getArabicUnit(webhook.timer_unit)} بدون رد
                    </span>
                </div>
            </div>
            <button type="button" class="btn-icon-danger" onclick="deleteIncomingUnrepliedWebhook(${webhook.id})" title="حذف">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
        </div>
    `).join('');
}

/**
 * Update incoming unreplied webhook count display
 */
function updateIncomingUnrepliedWebhookCount() {
    const badge = document.getElementById('incomingUnrepliedWebhookCountBadge');
    if (!badge) return;

    const count = currentIncomingUnrepliedWebhooks.length;
    badge.textContent = count > 0 ? `${count} مفعل` : '0';

    // Dynamic badge styling
    if (count > 0) {
        badge.style.background = 'linear-gradient(135deg, #8b5cf6, #a78bfa)';
        badge.style.color = 'white';
    } else {
        badge.style.background = 'rgba(100, 116, 139, 0.1)';
        badge.style.color = 'var(--text-muted)';
    }
}

/**
 * Add a new incoming unreplied webhook
 */
async function addIncomingUnrepliedWebhook() {
    const url = document.getElementById('newIncomingUnrepliedWebhookUrl')?.value?.trim();
    const timer = document.getElementById('newIncomingUnrepliedWebhookTimer')?.value || 5;
    const unit = document.getElementById('newIncomingUnrepliedWebhookUnit')?.value || 'minutes';

    if (!url) {
        showToast('الرجاء إدخال رابط Webhook', 'error');
        return;
    }

    if (!currentProfileId) {
        showToast('خطأ: لم يتم تحديد الجهاز', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/profiles/${currentProfileId}/incoming-unreplied-webhooks`, {
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
            document.getElementById('newIncomingUnrepliedWebhookUrl').value = '';
            document.getElementById('newIncomingUnrepliedWebhookTimer').value = '';

            // Reload webhooks
            await loadIncomingUnrepliedWebhooks(currentProfileId);
        } else {
            showToast(data.error || 'فشل في إضافة Webhook', 'error');
        }
    } catch (error) {
        showToast('خطأ في إضافة Webhook', 'error');
    }
}

/**
 * Delete an incoming unreplied webhook
 */
async function deleteIncomingUnrepliedWebhook(webhookId) {
    console.log('🗑️ Delete incoming unreplied webhook clicked, webhookId:', webhookId, 'currentProfileId:', currentProfileId);

    if (!currentProfileId) {
        showToast('خطأ: لم يتم تحديد الجهاز', 'error');
        console.error('currentProfileId is null or undefined');
        return;
    }

    if (!confirm('هل أنت متأكد من حذف هذا الـ Webhook؟')) {
        return;
    }

    try {
        const url = `/api/profiles/${currentProfileId}/incoming-unreplied-webhooks/${webhookId}`;
        console.log('🗑️ Deleting incoming unreplied webhook at:', url);

        const response = await fetch(url, {
            method: 'DELETE'
        });

        const data = await response.json();
        console.log('🗑️ Delete response:', data);

        if (data.success) {
            showToast('تم حذف Webhook', 'success');
            await loadIncomingUnrepliedWebhooks(currentProfileId);
        } else {
            showToast(data.error || 'فشل في حذف Webhook', 'error');
        }
    } catch (error) {
        console.error('Error deleting incoming unreplied webhook:', error);
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
    const expectedId = document.getElementById('disconnectProfileId').textContent.trim();
    const enteredId = document.getElementById('confirmProfileId').value.trim();

    console.log('🔍 Validating:', { expectedId, enteredId, match: enteredId === expectedId });

    const isMatch = enteredId === expectedId;
    const btn = document.getElementById('confirmDisconnectBtn');
    btn.disabled = !isMatch;
    console.log('🔘 Button disabled:', btn.disabled);

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
    console.log('🔌 executeDisconnect called, targetId:', disconnectTargetId);
    if (!disconnectTargetId) {
        console.error('❌ No disconnectTargetId set!');
        return;
    }

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

    // Show modal and reset state (qrLoading doesn't exist - using status message instead)
    const qrDisplay = document.getElementById('qrDisplay');
    const qrConnected = document.getElementById('qrConnected');

    if (qrDisplay) qrDisplay.classList.add('hidden');
    if (qrConnected) qrConnected.classList.add('hidden');

    // Reset progress to initializing step
    updateProgress('initializing');
    updateStatusMessage('جاري تهيئة الجهاز...', 'يتم بدء عملية الاتصال');

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


/* ================================
   WEBHOOKS MODAL LOGIC
   ================================ */

const webhookModal = document.getElementById('webhookModal');

/**
 * Open Webhooks Management Modal
 */
function openWebhooksModal(id) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    currentProfileId = id;
    document.getElementById('webhookProfileId').value = id;

    // Set Main Webhook
    document.getElementById('mainWebhookUrl').value = profile.webhook_url || '';

    // Set Echo Checkbox
    document.getElementById('webhookEchoEnabled').checked = profile.webhook_echo_enabled || false;

    // Load Advanced Webhooks
    loadUnreadWebhooks(id);
    loadNoReplyWebhooks(id);
    loadIncomingUnrepliedWebhooks(id);

    // Reset Panels
    document.querySelectorAll('.webhook-option-card').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.webhook-panel').forEach(p => p.classList.add('hidden'));

    webhookModal.classList.remove('hidden');
}

/**
 * Close Webhooks Modal
 */
function closeWebhooksModal() {
    webhookModal.classList.add('hidden');
}

/**
 * Save Main Webhook
 */
async function saveMainWebhook() {
    const id = document.getElementById('webhookProfileId').value;
    const url = document.getElementById('mainWebhookUrl').value;

    try {
        const response = await fetch(`/api/profiles/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook_url: url || null })
        });

        const result = await response.json();

        if (result.success) {
            showToast('تم تحديث Webhook الرئيسي بنجاح', 'success');
            loadProfiles(); // Refresh to update indicator
        } else {
            showToast(result.error || 'خطأ في حفظ Webhook', 'error');
        }
    } catch (error) {
        console.error('Error saving main webhook:', error);
        showToast('خطأ في حفظ Webhook', 'error');
    }
}

/**
 * Save Echo Setting
 */
async function saveEchoSetting() {
    const id = document.getElementById('webhookProfileId').value;
    const echoEnabled = document.getElementById('webhookEchoEnabled').checked;

    try {
        const response = await fetch(`/api/profiles/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook_echo_enabled: echoEnabled })
        });

        const result = await response.json();

        if (result.success) {
            showToast(echoEnabled ? 'تم تفعيل Echo Mode' : 'تم إلغاء Echo Mode', 'success');
            loadProfiles(); // Refresh
        } else {
            showToast(result.error || 'خطأ في حفظ الإعداد', 'error');
            // Revert checkbox
            document.getElementById('webhookEchoEnabled').checked = !echoEnabled;
        }
    } catch (error) {
        console.error('Error saving echo setting:', error);
        showToast('خطأ في حفظ الإعداد', 'error');
        // Revert checkbox
        document.getElementById('webhookEchoEnabled').checked = !echoEnabled;
    }
}

/**
 * Toggle Webhook Panels (Accordion Style)
 */
function toggleWebhookPanel(type) {
    const card = document.querySelector(`.webhook-option-card.${type}`);
    const panel = document.getElementById(`${type}Panel`);

    let wasActive = false;
    if (card && card.classList.contains('active')) {
        wasActive = true;
    }

    // Close all first
    document.querySelectorAll('.webhook-option-card').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.webhook-panel').forEach(p => p.classList.add('hidden'));

    if (!wasActive && card && panel) {
        card.classList.add('active');
        panel.classList.remove('hidden');
    }
}

// ============================================
// PROGRESS TRACKER FUNCTIONS
// ============================================

/**
 * Reset all progress steps to inactive state
 */
function resetProgress() {
    const steps = document.querySelectorAll('.progress-step');
    steps.forEach(step => {
        step.classList.remove('active', 'completed');
    });
}

/**
 * Update progress tracker to show current connection stage
 * @param {string} stage - One of: 'initializing', 'qr', 'scanning', 'authenticating', 'connected'
 */
function updateProgress(stage) {
    const steps = document.querySelectorAll('.progress-step');
    const stageOrder = ['initializing', 'qr', 'scanning', 'authenticating', 'connected'];
    const currentIndex = stageOrder.indexOf(stage);

    steps.forEach((step, index) => {
        const stepStage = step.getAttribute('data-step');
        const stepIndex = stageOrder.indexOf(stepStage);

        step.classList.remove('active', 'completed');

        if (stepIndex < currentIndex) {
            step.classList.add('completed');
        } else if (stepIndex === currentIndex) {
            step.classList.add('active');
        }
    });
}

/**
 * Update status message displayed to user
 * @param {string} mainText - Primary status message
 * @param {string} detailText - Optional detailed explanation
 */
function updateStatusMessage(mainText, detailText = '') {
    const statusTextEl = document.getElementById('statusText');
    const statusDetailEl = document.getElementById('statusDetail');

    if (statusTextEl) {
        statusTextEl.textContent = mainText;
    }
    if (statusDetailEl) {
        statusDetailEl.textContent = detailText;
    }
}

/**
 * Update the webhook timer unit (Smart Selector)
 * @param {string} inputId - ID of the hidden input
 * @param {string} value - Unit value (minutes, hours, days)
 * @param {HTMLElement} btn - The button clicked
 */
function setUnit(inputId, value, btn) {
    // Update hidden input
    document.getElementById(inputId).value = value;

    // Update visual state
    const parent = btn.parentElement;
    parent.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update placeholder based on context
    const container = btn.closest('.form-row-group');
    const timerInput = container.querySelector('.input-timer');
    if (timerInput) {
        if (value === 'days') timerInput.placeholder = '1';
        else if (value === 'hours') timerInput.placeholder = '2';
        else timerInput.placeholder = '30';
    }
}
