/**
 * API Message Logs JavaScript
 */

const socket = io();

let currentPage = 0;
let pageSize = 50;
let currentFilters = {};
let batchColors = {}; // Store random colors for each batch

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadLogs();
    loadStats();
    loadBatches();
    setupSocketListeners();
    setupTheme();
});

// Load batches
async function loadBatches() {
    try {
        const response = await fetch('/api/logs/batches');
        const data = await response.json();

        if (data.success) {
            renderBatches(data.batches);
        }
    } catch (error) {
        console.error('Error loading batches:', error);
    }
}

// Render batches (only show incomplete ones)
function renderBatches(batches) {
    const container = document.getElementById('batchesContainer');

    // Filter out completed batches (where queued + pending = 0)
    const pendingBatches = batches.filter(b =>
        (parseInt(b.queued) || 0) + (parseInt(b.pending) || 0) > 0
    );

    if (!pendingBatches || pendingBatches.length === 0) {
        container.innerHTML = '<div class="empty-batches">✅ No pending batches</div>';
        return;
    }

    // Show max 6 cards (2 rows of 3)
    const visibleBatches = pendingBatches.slice(0, 6);
    const hasMore = pendingBatches.length > 6;

    // Store all batches for modal
    window.allPendingBatches = pendingBatches;

    let html = visibleBatches.map(batch => renderBatchCard(batch)).join('');

    if (hasMore) {
        html += `
            <div class="view-more-card" onclick="openBatchesModal()">
                <span class="view-more-icon">📦</span>
                <span class="view-more-text">View ${pendingBatches.length - 6} more</span>
            </div>
        `;
    }

    container.innerHTML = html;
}

// Render single batch card
function renderBatchCard(batch) {
    return `
        <div class="batch-card" data-batch="${batch.batch_id}">
            <div class="batch-header">
                <span class="batch-id-full" title="${batch.batch_id}">${batch.batch_id.substring(0, 8)}...</span>
                <span class="batch-time">${formatDate(batch.created_at)}</span>
            </div>
            <div class="batch-stats">
                <span class="stat queued">🕐 ${batch.queued}</span>
                <span class="stat pending">⏳ ${batch.pending}</span>
                <span class="stat sent">✓ ${batch.sent}</span>
                <span class="stat failed">❌ ${batch.failed}</span>
                <span class="stat total">📊 ${batch.total_messages}</span>
            </div>
            <div class="batch-actions">
                <button class="btn btn-sm btn-danger" onclick="deleteBatch('${batch.batch_id}')">
                    🗑️ Delete
                </button>
            </div>
        </div>
    `;
}

// Open batches modal
function openBatchesModal() {
    const modal = document.getElementById('batchesModal');
    const modalBody = document.getElementById('batchesModalBody');

    if (!window.allPendingBatches) return;

    modalBody.innerHTML = window.allPendingBatches.map(batch => renderBatchCard(batch)).join('');
    modal.classList.remove('hidden');
}

// Close batches modal
function closeBatchesModal() {
    document.getElementById('batchesModal').classList.add('hidden');
}

// Delete batch
async function deleteBatch(batchId) {
    if (!confirm(`Are you sure you want to DELETE this batch?\n\nBatch ID: ${batchId}\n\nThis will remove ALL messages from this batch and cancel any pending sends.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/logs/batch/${batchId}`, {
            method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
            alert(`✅ Batch deleted!\n\n${data.deletedCount} messages removed.\n${data.alreadySent} were already sent.`);
            loadBatches();
            loadLogs();
            loadStats();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Error deleting batch:', error);
        alert('Error deleting batch');
    }
}

// Load logs from API
async function loadLogs() {
    try {
        const params = new URLSearchParams({
            limit: pageSize,
            offset: currentPage * pageSize,
            ...currentFilters
        });

        const response = await fetch(`/api/logs?${params}`);
        const data = await response.json();

        if (data.success) {
            renderLogs(data.messages);
            updatePagination(data.messages.length);
        }
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('/api/logs/stats');
        const data = await response.json();

        if (data.success) {
            document.getElementById('statQueued').textContent = data.stats.queued || 0;
            document.getElementById('statSent').textContent = data.stats.sent || 0;
            document.getElementById('statDelivered').textContent = data.stats.delivered || 0;
            document.getElementById('statRead').textContent = data.stats.read || 0;
            document.getElementById('statFailed').textContent = data.stats.failed || 0;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Render logs table
function renderLogs(messages) {
    const tbody = document.getElementById('logsTableBody');
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.querySelector('.table-container');

    if (!messages || messages.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
        tableContainer.style.display = 'none';
        return;
    }

    emptyState.classList.add('hidden');
    tableContainer.style.display = 'block';

    tbody.innerHTML = messages.map(msg => {
        const batchId = msg.batch_id || msg.whatsapp_message_id || '-';
        const bgColor = getBatchColor(msg.batch_id);

        return `
        <tr data-id="${msg.id}" style="${bgColor ? `background-color: ${bgColor}` : ''}">
            <td>#${msg.id}</td>
            <td><span class="batch-id-cell" title="${batchId}">${batchId}</span></td>
            <td>${formatPhone(msg.recipient)}</td>
            <td><span class="message-preview" title="${escapeHtml(msg.resolved_content || msg.original_content)}">${escapeHtml((msg.resolved_content || msg.original_content || '').substring(0, 50))}</span></td>
            <td>${getStatusBadge(msg.status, msg.ack_level)}</td>
            <td><span class="timestamp">${formatDate(msg.scheduled_at)}</span></td>
            <td><span class="timestamp">${msg.sent_at ? formatDate(msg.sent_at) : '-'}</span></td>
        </tr>
    `}).join('');
}

// Get random color for batch with 20% opacity
function getBatchColor(batchId) {
    if (!batchId) return null;

    if (!batchColors[batchId]) {
        const hue = Math.floor(Math.random() * 360);
        batchColors[batchId] = `hsla(${hue}, 70%, 60%, 0.15)`;
    }
    return batchColors[batchId];
}

// Change page size
function changePageSize() {
    const select = document.getElementById('rowsPerPage');
    const value = select.value;

    if (value === 'all') {
        pageSize = 99999;
    } else {
        pageSize = parseInt(value);
    }

    currentPage = 0;
    loadLogs();
}

// Get status badge HTML
function getStatusBadge(status, ackLevel) {
    const badges = {
        'queued': '<span class="status-badge queued">🕐 Queued</span>',
        'sending': '<span class="status-badge sending">⏳ Sending</span>',
        'sent': '<span class="status-badge sent">✓ Sent</span>',
        'delivered': '<span class="status-badge delivered">✓✓ Delivered</span>',
        'read': '<span class="status-badge read">✓✓ Read</span>',
        'failed': '<span class="status-badge failed">❌ Failed</span>'
    };
    return badges[status] || `<span class="status-badge">${status}</span>`;
}

// Format phone number
function formatPhone(phone) {
    if (!phone) return '-';
    return phone.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3 $4');
}

// Format date
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Apply filters
function applyFilters() {
    const status = document.getElementById('filterStatus').value;
    const batch = document.getElementById('filterBatch').value.trim();

    currentFilters = {};
    if (status) currentFilters.status = status;
    if (batch) currentFilters.batch_id = batch;

    currentPage = 0;
    loadLogs();
}

// Pagination
function updatePagination(count) {
    document.getElementById('pageInfo').textContent = `Page ${currentPage + 1}`;
    document.getElementById('prevBtn').disabled = currentPage === 0;
    document.getElementById('nextBtn').disabled = count < pageSize;
}

function prevPage() {
    if (currentPage > 0) {
        currentPage--;
        loadLogs();
    }
}

function nextPage() {
    currentPage++;
    loadLogs();
}

// Refresh
function refreshLogs() {
    loadLogs();
    loadStats();
}

// Socket.IO listeners for real-time updates
function setupSocketListeners() {
    socket.on('queue_update', (data) => {
        console.log('Queue update:', data);

        // Update the row if visible
        const row = document.querySelector(`tr[data-id="${data.id}"]`);
        if (row) {
            const statusCell = row.querySelector('td:nth-child(5)');
            if (statusCell) {
                statusCell.innerHTML = getStatusBadge(data.status, data.ack_level);
            }
        }

        // Refresh stats
        loadStats();
    });

    socket.on('message_ack', (data) => {
        console.log('Message ACK:', data);
        loadStats();
    });
}

// Theme toggle
function setupTheme() {
    const themeToggle = document.getElementById('themeToggle');

    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        themeToggle.innerHTML = '<span class="theme-icon">☀️</span><span class="theme-text">Light Mode</span>';
    }

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('darkMode', isDark);
        themeToggle.innerHTML = isDark
            ? '<span class="theme-icon">☀️</span><span class="theme-text">Light Mode</span>'
            : '<span class="theme-icon">🌙</span><span class="theme-text">Dark Mode</span>';
    });
}

// Auto-refresh every 30 seconds
setInterval(() => {
    if (document.visibilityState === 'visible') {
        loadStats();
    }
}, 30000);
