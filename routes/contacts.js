/**
 * Contacts Routes
 * API endpoints for contact operations
 */

const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const whatsappManager = require('../whatsapp-manager');

const fs = require('fs');
const path = require('path');

const DEBUG_LOG_PATH = path.join(__dirname, '..', 'extraction_debug.txt');

function logDebug(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(DEBUG_LOG_PATH, logMessage);
    } catch (e) {
        // Fallback if file write fails, though console logs are usually not seen
        console.error('Failed to write to log file:', e);
    }
    console.log(logMessage.trim());
}



/**
 * GET /api/contacts
 * Get all contacts
 */
router.get('/', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const type = req.query.type || 'all'; // 'all', 'groups', 'history'

        const contacts = await Contact.getAll(clientId, limit, offset, type);
        res.json({ success: true, data: contacts });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contacts/stats
 * Get contact statistics
 */
router.get('/stats', async (req, res) => {
    try {
        // If clientId is provided, use it. Otherwise pass null to get ALL stats.
        const clientId = req.query.clientId ? parseInt(req.query.clientId) : null;
        const type = req.query.type || 'all';
        const stats = await Contact.getCount(clientId, type);
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching contact stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/extract-live
 * Extract contacts directly from WhatsApp WITHOUT saving to database
 * Returns ONLY contacts with actual chat history (not AI bots)
 */
router.post('/extract-live', async (req, res) => {
    try {
        const requestedProfileId = req.query.profileId || req.body.profileId;
        const allStatus = whatsappManager.getAllStatus();
        let activeProfileId;

        if (requestedProfileId) {
            const reqId = parseInt(requestedProfileId);
            if (allStatus[reqId] && allStatus[reqId].connected) {
                activeProfileId = reqId;
            } else {
                return res.status(400).json({ success: false, error: 'الجهاز المحدد غير متصل' });
            }
        } else {
            activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
        }

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'لا يوجد جهاز متصل' });
        }

        logDebug(`[Extract-Live] Starting for profile ${activeProfileId}`);
        const waClient = whatsappManager.getClient(parseInt(activeProfileId));

        let contacts = [];
        let method = '';

        // Method 1: Chat Store - Gets ONLY contacts with actual chat history (what user wants)
        try {
            logDebug(`[Extract-Live] Trying Chat Store (actual conversations only)...`);
            const storeChats = await waClient.pupPage.evaluate(() => {
                if (window.Store && window.Store.Chat) {
                    return window.Store.Chat.getModelsArray()
                        .filter(chat => {
                            // Only individual chats (not groups), only @c.us (not AI bots which use @lid or other)
                            const isIndividual = !chat.isGroup;
                            const isRealUser = chat.id._serialized.includes('@c.us');
                            // Filter out Meta AI characters (they have specific patterns)
                            const isNotAI = !chat.id._serialized.includes('@lid') &&
                                !chat.id._serialized.startsWith('13135550');
                            return isIndividual && isRealUser && isNotAI;
                        })
                        .map(chat => ({
                            id: chat.id._serialized,
                            phone: chat.id.user,
                            name: chat.name || chat.formattedTitle || chat.contact?.pushname || chat.contact?.name || null
                        }));
                }
                return [];
            });

            if (storeChats && storeChats.length > 0) {
                method = 'محادثات فعلية';
                contacts = storeChats;
                logDebug(`[Extract-Live] Chat Store found ${contacts.length} real conversation contacts`);
            }
        } catch (e) {
            logDebug(`[Extract-Live] Chat Store failed: ${e.message}`);
        }

        // Method 2: Fallback - getContacts but filter heavily
        if (contacts.length === 0) {
            try {
                logDebug(`[Extract-Live] Trying getContacts (filtered)...`);
                const waContacts = await waClient.getContacts();

                contacts = waContacts
                    .filter(c => {
                        const isUser = c.isUser && !c.isGroup;
                        const isRealUser = c.id._serialized.includes('@c.us');
                        // Filter AI characters by phone pattern (Meta AI uses 1313555xxxx)
                        const phone = c.number || c.id.user || '';
                        const isNotAI = !phone.startsWith('1313555') && !c.id._serialized.includes('@lid');
                        return isUser && isRealUser && isNotAI;
                    })
                    .map(c => ({
                        id: c.id._serialized,
                        phone: c.number || c.id.user,
                        name: c.name || c.pushname || null
                    }));

                method = 'جهات اتصال (مفلترة)';
                logDebug(`[Extract-Live] getContacts found ${contacts.length} contacts (filtered)`);
            } catch (e) {
                logDebug(`[Extract-Live] getContacts failed: ${e.message}`);
            }
        }

        logDebug(`[Extract-Live] Completed. Total: ${contacts.length} via ${method}`);

        res.json({
            success: true,
            message: `تم استخراج ${contacts.length} رقم من المحادثات الفعلية`,
            count: contacts.length,
            method,
            contacts: contacts
        });
    } catch (error) {
        logDebug(`[Extract-Live] Error: ${error.message}`);
        console.error('Error in extract-live:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/export-live-csv
 * Generate CSV from provided contacts (no database)
 */
router.post('/export-live-csv', (req, res) => {
    try {
        const { contacts } = req.body;

        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ success: false, error: 'لا توجد أرقام للتصدير' });
        }

        // Create CSV content
        const BOM = '\uFEFF';
        let csv = BOM + 'الاسم,رقم الهاتف\n';

        for (const contact of contacts) {
            const name = (contact.name || 'بدون اسم').replace(/,/g, ' ').replace(/"/g, "'");
            const phone = contact.phone || '';
            csv += `"${name}","=""${phone}"""\n`;
        }

        const filename = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('Error exporting live CSV:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ... (skipping some routes)

/**
 * POST /api/contacts/sync
 * Sync contacts from WhatsApp
 */
router.post('/sync', async (req, res) => {
    try {
        // Accept clientId from query or body
        const requestedClientId = req.query.clientId || req.body.clientId;
        const allStatus = whatsappManager.getAllStatus();
        let waClient = null;
        let activeProfileId = null;

        if (requestedClientId) {
            const requestedId = parseInt(requestedClientId);
            if (allStatus[requestedId] && allStatus[requestedId].connected) {
                activeProfileId = requestedId;
                waClient = whatsappManager.getClient(requestedId);
            } else {
                return res.status(400).json({ success: false, error: 'Selected device is not connected' });
            }
        } else {
            activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
            if (activeProfileId) {
                waClient = whatsappManager.getClient(parseInt(activeProfileId));
            }
        }

        if (!waClient) {
            return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
        }

        logDebug(`[Sync] Starting contact sync for Profile ${activeProfileId}`);

        const waContacts = await waClient.getContacts();
        logDebug(`[Sync] Found ${waContacts.length} raw contacts from WhatsApp`);

        let synced = 0;
        let errors = 0;

        for (const contact of waContacts) {
            try {
                // Log first few for debugging structure
                if (synced < 3) {
                    logDebug(`[Sync] Sample Contact: ${JSON.stringify({
                        id: contact.id,
                        isUser: contact.isUser,
                        name: contact.name,
                        number: contact.number
                    })}`);
                }

                if (contact.isUser && contact.id._serialized) {
                    await Contact.upsert({
                        client_id: parseInt(activeProfileId),
                        contact_id: contact.id._serialized,
                        phone_number: contact.number,
                        name: contact.name,
                        push_name: contact.pushname,
                        short_name: contact.shortName,
                        is_business: contact.isBusiness,
                        is_blocked: contact.isBlocked,
                        is_my_contact: contact.isMyContact
                    });
                    synced++;
                }
            } catch (err) {
                if (errors < 5) logDebug(`[Sync] Error saving contact: ${err.message}`);
                errors++;
            }
        }

        logDebug(`[Sync] Completed. Synced: ${synced}, Errors: ${errors}`);
        logDebug(`[Sync] SUCCESS - Final count synced to DB: ${synced}`);

        res.json({ success: true, message: `تم مزامنة ${synced} جهة اتصال`, debugInfo: { totalFound: waContacts.length, synced } });
    } catch (error) {
        logDebug(`[Sync] Fatal error: ${error.message}`);
        console.error('Error syncing contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contacts/export-csv
 * Export contacts as CSV file
 */
router.get('/export-csv', async (req, res) => {
    try {
        // Get clientId from query, or find the connected profile's ID
        let clientId = req.query.clientId;

        if (!clientId) {
            // Auto-detect: find the first connected profile's ID
            const allStatus = whatsappManager.getAllStatus();
            const connectedProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
            clientId = connectedProfileId ? parseInt(connectedProfileId) : null;
            logDebug(`[CSV Export] Auto-detected clientId: ${clientId}`);
        } else {
            clientId = parseInt(clientId);
        }

        const type = req.query.type || 'all'; // 'all' or 'recent'

        let contacts;
        if (type === 'recent') {
            contacts = await Contact.getAll(clientId, 10000, 0, 'recent');
        } else {
            contacts = await Contact.getAll(clientId, 10000, 0);
        }

        logDebug(`[CSV Export] Found ${contacts.length} contacts for clientId=${clientId}, type=${type}`);

        // Create CSV content
        const BOM = '\uFEFF'; // UTF-8 BOM for Arabic support in Excel
        let csv = BOM + 'الاسم,رقم الهاتف,تاريخ الإضافة\n';

        for (const contact of contacts) {
            const name = (contact.name || contact.push_name || 'بدون اسم').replace(/,/g, ' ').replace(/"/g, "'");
            const phone = contact.phone_number || '';
            const date = contact.created_at ? new Date(contact.created_at).toLocaleDateString('ar-EG') : '';
            // Use ="number" formula format - displays as text without visible prefix
            csv += `"${name}","=""${phone}""","${date}"\n`;
        }

        // Set headers for file download
        const filename = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('Error exporting contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contacts/search
 * Search contacts
 */
router.get('/search', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({ success: false, error: 'Search query required' });
        }

        const contacts = await Contact.search(clientId, q);
        res.json({ success: true, data: contacts });
    } catch (error) {
        console.error('Error searching contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contacts/blocked
 * Get blocked contacts
 */
router.get('/blocked', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const contacts = await Contact.getBlocked(clientId);
        res.json({ success: true, data: contacts });
    } catch (error) {
        console.error('Error fetching blocked contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contacts/groups
 * Get list of WhatsApp groups for extraction
 */
router.get('/groups', async (req, res) => {
    try {
        const profileId = req.query.profileId;
        const allStatus = whatsappManager.getAllStatus();

        // If profileId provided, check if connected. Else find first connected.
        let activeProfileId;
        if (profileId) {
            if (allStatus[profileId] && allStatus[profileId].connected) {
                activeProfileId = profileId;
            } else {
                return res.status(400).json({ success: false, error: 'الجهاز المحدد غير متصل' });
            }
        } else {
            activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
        }

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'لا يوجد جهاز متصل' });
        }

        const waClient = whatsappManager.getClient(parseInt(activeProfileId));
        let groups = [];
        let method = '';

        // Method 1: getChats() - More reliable for new devices
        try {
            console.log(`[Groups] Trying getChats() for profile ${activeProfileId}...`);
            const chats = await waClient.getChats();
            groups = chats
                .filter(c => c.isGroup)
                .map(c => ({
                    id: c.id._serialized,
                    name: c.name || 'مجموعة بدون اسم',
                    participantsCount: c.participants?.length || null
                }));
            method = 'getChats';
            console.log(`[Groups] getChats() found ${groups.length} groups`);
        } catch (error) {
            console.error('[Groups] getChats() failed:', error.message);
        }

        // Method 2: getContacts() backup
        if (groups.length === 0) {
            try {
                console.log(`[Groups] Trying getContacts() backup...`);
                const contacts = await waClient.getContacts();
                groups = contacts
                    .filter(c => c.isGroup)
                    .map(c => ({
                        id: c.id._serialized,
                        name: c.name || c.verifiedName || 'مجموعة بدون اسم',
                        participantsCount: null
                    }));
                method = 'getContacts';
                console.log(`[Groups] getContacts() found ${groups.length} groups`);
            } catch (error) {
                console.error('[Groups] getContacts() failed:', error.message);
            }
        }

        // Method 3: Direct Store access backup
        if (groups.length === 0) {
            try {
                console.log(`[Groups] Trying Store access...`);
                const storeGroups = await waClient.pupPage.evaluate(() => {
                    if (window.Store && window.Store.Chat) {
                        return window.Store.Chat.getModelsArray()
                            .filter(chat => chat.isGroup)
                            .map(chat => ({
                                id: chat.id._serialized,
                                name: chat.name || chat.formattedTitle || 'مجموعة بدون اسم'
                            }));
                    }
                    return [];
                });
                groups = storeGroups;
                method = 'Store';
                console.log(`[Groups] Store found ${groups.length} groups`);
            } catch (error) {
                console.error('[Groups] Store access failed:', error.message);
            }
        }

        res.json({ success: true, count: groups.length, groups, method });
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/contacts/:id
 * Get contact by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const contact = await Contact.getById(req.params.id);
        if (!contact) {
            return res.status(404).json({ success: false, error: 'Contact not found' });
        }
        res.json({ success: true, data: contact });
    } catch (error) {
        console.error('Error fetching contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/:id/block
 * Block a contact
 */
router.post('/:id/block', async (req, res) => {
    try {
        const { id } = req.params;

        // Block in WhatsApp (using first connected profile)
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
        const waClient = activeProfileId ? whatsappManager.getClient(parseInt(activeProfileId)) : null;
        if (waClient) {
            try {
                const contact = await waClient.getContactById(id);
                if (contact) {
                    await contact.block();
                }
            } catch (waError) {
                console.error('WhatsApp block error:', waError);
            }
        }

        // Update in database
        const contact = await Contact.setBlocked(id, true);
        res.json({ success: true, data: contact });
    } catch (error) {
        console.error('Error blocking contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/:id/unblock
 * Unblock a contact
 */
router.post('/:id/unblock', async (req, res) => {
    try {
        const { id } = req.params;

        // Unblock in WhatsApp (using first connected profile)
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
        const waClient = activeProfileId ? whatsappManager.getClient(parseInt(activeProfileId)) : null;
        if (waClient) {
            try {
                const contact = await waClient.getContactById(id);
                if (contact) {
                    await contact.unblock();
                }
            } catch (waError) {
                console.error('WhatsApp unblock error:', waError);
            }
        }

        // Update in database
        const contact = await Contact.setBlocked(id, false);
        res.json({ success: true, data: contact });
    } catch (error) {
        console.error('Error unblocking contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/sync
 * Sync contacts from WhatsApp
 */
router.post('/sync', async (req, res) => {
    try {
        // Accept clientId from query or body
        const requestedClientId = req.query.clientId || req.body.clientId;
        const allStatus = whatsappManager.getAllStatus();
        let waClient = null;
        let activeProfileId = null;

        if (requestedClientId) {
            // If client ID requested, check if valid and connected
            const requestedId = parseInt(requestedClientId);
            if (allStatus[requestedId] && allStatus[requestedId].connected) {
                activeProfileId = requestedId;
                waClient = whatsappManager.getClient(requestedId);
            } else {
                return res.status(400).json({ success: false, error: 'Selected device is not connected' });
            }
        } else {
            // Fallback: Get first connected profile
            activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
            if (activeProfileId) {
                waClient = whatsappManager.getClient(parseInt(activeProfileId));
            }
        }

        if (!waClient) {
            return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
        }

        const waContacts = await waClient.getContacts();
        let synced = 0;

        // Filter valid contacts first
        const validContacts = waContacts.filter(c => c.isUser && c.id._serialized);

        // Process in chunks of 50 to avoid DB pool exhaustion but allow parallelism
        const CHUNK_SIZE = 50;
        for (let i = 0; i < validContacts.length; i += CHUNK_SIZE) {
            const chunk = validContacts.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (contact) => {
                try {
                    await Contact.upsert({
                        client_id: parseInt(activeProfileId), // Fix: use resolved activeProfileId
                        contact_id: contact.id._serialized,
                        phone_number: contact.number,
                        name: contact.name,
                        push_name: contact.pushname,
                        short_name: contact.shortName,
                        is_business: contact.isBusiness,
                        is_blocked: contact.isBlocked,
                        is_my_contact: contact.isMyContact
                    });
                    synced++;
                } catch (err) {
                    console.error(`Failed to sync contact ${contact.number}:`, err.message);
                }
            }));
        }

        res.json({ success: true, message: `Synced ${synced} contacts` });
    } catch (error) {
        console.error('Error syncing contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/extract-groups
 * Extract contacts from selected WhatsApp groups
 */
router.post('/extract-groups', async (req, res) => {
    try {
        const { groupIds } = req.body; // Array of group IDs

        if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ success: false, error: 'Group IDs required' });
        }

        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
        }

        const waClient = whatsappManager.getClient(parseInt(activeProfileId));
        let extractedCount = 0;
        let errors = [];

        for (const groupId of groupIds) {
            try {
                logDebug(`Extracting from Group: ${groupId}`);
                let participants = [];
                let groupName = 'Group';

                // METHOD 1: DOM Scraping - Open group info and read phone numbers from UI
                try {
                    logDebug(`  Trying DOM scraping method...`);
                    const domResult = await waClient.pupPage.evaluate(async (gId) => {
                        try {
                            const Store = window.Store;
                            if (!Store) return { success: false, error: 'Store not available' };

                            // Step 1: Open the chat
                            if (Store.Cmd && Store.Cmd.openChatAt) {
                                await Store.Cmd.openChatAt(gId);
                            }
                            await new Promise(r => setTimeout(r, 1000));

                            // Step 2: Click on group header to open group info panel
                            const header = document.querySelector('#main header');
                            if (header) {
                                header.click();
                                await new Promise(r => setTimeout(r, 1500));
                            }

                            // Step 3: Look for "View all" or participants section and scroll
                            let phoneNumbers = [];

                            // Try to find participant elements in the side panel
                            const tryExtractFromDOM = async () => {
                                // Wait for side panel
                                await new Promise(r => setTimeout(r, 500));

                                // Look for participant list items
                                const participantItems = document.querySelectorAll('[data-testid="cell-frame-container"], [data-testid="contact-info-drawer"] [role="listitem"], [data-testid="group-participant"]');

                                for (const item of participantItems) {
                                    // Look for phone number text in the item
                                    const spans = item.querySelectorAll('span');
                                    for (const span of spans) {
                                        const text = span.textContent || '';
                                        // Match phone number patterns (with or without +, spaces, dashes)
                                        const phoneMatch = text.match(/[\+]?[\d\s\-\(\)]{10,20}/);
                                        if (phoneMatch) {
                                            // Clean the phone number
                                            const cleaned = phoneMatch[0].replace(/[\s\-\(\)\+]/g, '');
                                            if (cleaned.length >= 10 && cleaned.length <= 15 && /^\d+$/.test(cleaned)) {
                                                phoneNumbers.push(cleaned);
                                            }
                                        }
                                    }
                                }

                                // Also try to find participant titles/subtitles
                                const titles = document.querySelectorAll('[title*="+"]');
                                for (const el of titles) {
                                    const text = el.getAttribute('title') || '';
                                    const phoneMatch = text.match(/[\+]?[\d\s\-\(\)]{10,20}/);
                                    if (phoneMatch) {
                                        const cleaned = phoneMatch[0].replace(/[\s\-\(\)\+]/g, '');
                                        if (cleaned.length >= 10 && cleaned.length <= 15 && /^\d+$/.test(cleaned)) {
                                            phoneNumbers.push(cleaned);
                                        }
                                    }
                                }
                            };

                            await tryExtractFromDOM();

                            // Look for "See all" button and click it
                            const seeAllButtons = document.querySelectorAll('[data-testid="group-info-participants-show-all"]');
                            for (const btn of seeAllButtons) {
                                btn.click();
                                await new Promise(r => setTimeout(r, 1000));
                                await tryExtractFromDOM();
                            }

                            // Remove duplicates
                            phoneNumbers = [...new Set(phoneNumbers)];

                            // Get group name
                            let name = 'Group';
                            const nameEl = document.querySelector('[data-testid="conversation-info-header-chat-title"], [data-testid="group-info-drawer"] span[title]');
                            if (nameEl) {
                                name = nameEl.textContent || nameEl.getAttribute('title') || 'Group';
                            }

                            // Close the side panel by clicking elsewhere or pressing Escape
                            const closeBtn = document.querySelector('[data-testid="btn-close-drawer"]');
                            if (closeBtn) closeBtn.click();

                            return {
                                success: phoneNumbers.length > 0,
                                participants: phoneNumbers.map(p => ({ id: p + '@c.us', user: p })),
                                name,
                                count: phoneNumbers.length,
                                method: 'DOM'
                            };
                        } catch (err) {
                            return { success: false, error: err.toString() };
                        }
                    }, groupId);

                    if (domResult.success && domResult.participants && domResult.participants.length > 0) {
                        participants = domResult.participants;
                        groupName = domResult.name;
                        logDebug(`  DOM Success: Found ${participants.length} phone numbers from UI`);
                    } else {
                        logDebug(`  DOM method found 0 numbers, trying Store method...`);
                    }
                } catch (domError) {
                    logDebug(`  DOM error: ${domError.message}`);
                }

                // METHOD 2: Store-based extraction (fallback)
                if (participants.length === 0) {
                    try {
                        const result = await waClient.pupPage.evaluate(async (gId) => {
                            try {
                                const Store = window.Store;
                                if (!Store) {
                                    return { error: 'Store not available' };
                                }

                                // Step 1: Try to open the chat (forces metadata load)
                                if (Store.Cmd && Store.Cmd.openChatAt) {
                                    try {
                                        await Store.Cmd.openChatAt(gId);
                                    } catch (e) {
                                        // Ignore open errors, continue anyway
                                    }
                                } else if (Store.Chat && Store.Chat.find) {
                                    try {
                                        await Store.Chat.find(gId);
                                    } catch (e) {
                                        // Ignore
                                    }
                                }

                                // Step 2: Wait a moment for metadata to sync
                                await new Promise(r => setTimeout(r, 1500));

                                // Step 3: Get participants from GroupMetadata
                                let participants = [];
                                let name = 'Group';

                                if (Store.GroupMetadata) {
                                    let metadata = Store.GroupMetadata.get(gId);

                                    if (!metadata && Store.GroupMetadata.find) {
                                        try {
                                            metadata = await Store.GroupMetadata.find(gId);
                                        } catch (e) {
                                            // Continue
                                        }
                                    }

                                    if (metadata) {
                                        name = metadata.subject || 'Group';

                                        if (metadata.participants) {
                                            const parts = metadata.participants.getModelsArray
                                                ? metadata.participants.getModelsArray()
                                                : (Array.isArray(metadata.participants) ? metadata.participants : []);

                                            const totalRaw = parts.length;
                                            let lidCount = 0;
                                            let resolvedFromLid = 0;
                                            const debugInfo = {}; // For storing debug information about LID structure

                                            // Process ALL participants, try to resolve LID to phone
                                            for (const p of parts) {
                                                const id = p.id._serialized || p.id;

                                                if (id && id.includes('@c.us')) {
                                                    // Direct phone number
                                                    const user = p.id.user || id.split('@')[0];
                                                    if (user && user.length <= 15) {
                                                        participants.push({ id, user });
                                                    }
                                                } else if (id && id.includes('@lid')) {
                                                    lidCount++;
                                                    // Try to resolve LID to phone number
                                                    try {
                                                        // Log first LID participant's structure for debugging
                                                        if (lidCount === 1) {
                                                            const pKeys = Object.keys(p);
                                                            const idKeys = p.id ? Object.keys(p.id) : [];
                                                            debugInfo.firstLidParticipant = {
                                                                keys: pKeys.slice(0, 20),
                                                                idKeys: idKeys.slice(0, 20),
                                                                id: p.id ? { _serialized: p.id._serialized, user: p.id.user } : null
                                                            };
                                                        }

                                                        // Method 1: Try Store.Contact
                                                        if (Store.Contact) {
                                                            const contact = Store.Contact.get(id);
                                                            if (contact) {
                                                                if (lidCount === 1) {
                                                                    debugInfo.firstLidContact = {
                                                                        keys: Object.keys(contact).slice(0, 30),
                                                                        phoneNumber: contact.phoneNumber,
                                                                        number: contact.number,
                                                                        verifiedName: contact.verifiedName,
                                                                        pushname: contact.pushname,
                                                                        name: contact.name,
                                                                        formattedName: contact.formattedName
                                                                    };
                                                                }

                                                                const phone = contact.phoneNumber || contact.number ||
                                                                    (contact.wid && contact.wid.user) ||
                                                                    (contact.id && contact.id.user && !contact.id._serialized?.includes('@lid') ? contact.id.user : null);

                                                                if (phone && phone.length >= 10 && phone.length <= 15 && /^\d+$/.test(phone)) {
                                                                    participants.push({
                                                                        id: phone + '@c.us',
                                                                        user: phone,
                                                                        resolvedFromLid: true
                                                                    });
                                                                    resolvedFromLid++;
                                                                }
                                                            }
                                                        }

                                                        // Method 2: Try getNumberId from Store.Wid
                                                        if (!resolvedFromLid && Store.Wid && Store.Wid.get) {
                                                            try {
                                                                const wid = Store.Wid.get(id);
                                                                if (wid && wid.user && !wid._serialized?.includes('@lid')) {
                                                                    participants.push({
                                                                        id: wid.user + '@c.us',
                                                                        user: wid.user,
                                                                        resolvedFromLid: true
                                                                    });
                                                                    resolvedFromLid++;
                                                                }
                                                            } catch (e) { }
                                                        }
                                                    } catch (e) {
                                                        // Ignore contact lookup errors
                                                    }
                                                }
                                            }

                                            // Store debug info
                                            return {
                                                success: participants.length > 0,
                                                participants,
                                                name,
                                                count: participants.length,
                                                debug: {
                                                    totalRaw,
                                                    lidCount,
                                                    phoneCount: participants.length,
                                                    resolvedFromLid,
                                                    allLid: lidCount === totalRaw && totalRaw > 0 && participants.length === 0,
                                                    lidStructure: debugInfo // Include LID structure for debugging
                                                }
                                            };
                                        }
                                    }
                                }
                                // Fallback: Try Chat.participants directly
                                if (participants.length === 0 && Store.Chat) {
                                    const chat = Store.Chat.get(gId);
                                    if (chat && chat.groupMetadata && chat.groupMetadata.participants) {
                                        const parts = chat.groupMetadata.participants.getModelsArray
                                            ? chat.groupMetadata.participants.getModelsArray()
                                            : [];

                                        const totalRaw = parts.length;
                                        let lidCount = 0;
                                        let resolvedFromLid = 0;

                                        // Same logic: try to resolve LID to phone
                                        for (const p of parts) {
                                            const id = p.id._serialized || p.id;

                                            if (id && id.includes('@c.us')) {
                                                const user = p.id.user || id.split('@')[0];
                                                if (user && user.length <= 15) {
                                                    participants.push({ id, user });
                                                }
                                            } else if (id && id.includes('@lid')) {
                                                lidCount++;
                                                try {
                                                    if (Store.Contact) {
                                                        const contact = Store.Contact.get(id);
                                                        if (contact) {
                                                            const phone = contact.phoneNumber ||
                                                                (contact.wid && contact.wid.user) ||
                                                                (contact.id && contact.id.user && !contact.id._serialized.includes('@lid') ? contact.id.user : null);

                                                            if (phone && phone.length >= 10 && phone.length <= 15 && /^\d+$/.test(phone)) {
                                                                participants.push({
                                                                    id: phone + '@c.us',
                                                                    user: phone,
                                                                    resolvedFromLid: true
                                                                });
                                                                resolvedFromLid++;
                                                            }
                                                        }
                                                    }
                                                } catch (e) { }
                                            }
                                        }

                                        name = chat.name || name;

                                        return {
                                            success: participants.length > 0,
                                            participants,
                                            name,
                                            count: participants.length,
                                            debug: { totalRaw, lidCount, phoneCount: participants.length, resolvedFromLid }
                                        };
                                    }
                                }

                                return {
                                    success: participants.length > 0,
                                    participants,
                                    name,
                                    count: participants.length
                                };
                            } catch (err) {
                                return { error: err.toString() };
                            }
                        }, groupId);


                        if (result.success && result.participants && result.participants.length > 0) {
                            participants = result.participants;
                            groupName = result.name;
                            logDebug(`Success: Found ${participants.length} phone numbers in "${groupName}"`);
                            if (result.debug) {
                                logDebug(`  ↳ Debug: ${result.debug.totalRaw} total, ${result.debug.lidCount} LID, ${result.debug.phoneCount} phone, ${result.debug.resolvedFromLid || 0} resolved from LID`);
                            }
                        } else {
                            // Log why we didn't find any
                            if (result.debug && result.debug.allLid) {
                                logDebug(`Warning: Group "${result.name}" has ${result.debug.totalRaw} members but ALL are LID`);
                                // Log LID structure for debugging
                                if (result.debug.lidStructure) {
                                    logDebug(`  ↳ LID Structure: ${JSON.stringify(result.debug.lidStructure, null, 0)}`);
                                }
                            } else if (result.debug) {
                                logDebug(`Failed: ${result.debug.totalRaw} total, ${result.debug.lidCount} LID, ${result.debug.phoneCount} phone numbers`);
                            } else {
                                logDebug(`Failed: ${result.error || 'No participants found'}`);
                            }
                        }
                    } catch (evalError) {
                        logDebug(`Puppeteer error: ${evalError.message}`);
                    }
                } // Close: if (participants.length === 0) - Store method fallback

                // Save participants to database
                if (participants.length > 0) {
                    for (const participant of participants) {
                        try {
                            await Contact.upsert({
                                client_id: parseInt(activeProfileId),
                                contact_id: participant.id,
                                phone_number: participant.user,
                                name: null,
                                push_name: null,
                                short_name: null,
                                is_business: false,
                                is_blocked: false,
                                is_my_contact: false,
                                source: `Group: ${groupName}`,
                                tags: JSON.stringify(['extracted', 'group'])
                            });
                            extractedCount++;
                        } catch (e) {
                            logDebug(`Error saving ${participant.user}: ${e.message}`);
                        }
                    }
                } else {
                    errors.push({ groupId, error: 'Could not extract participants' });
                }
            } catch (groupError) {
                logDebug(`Error for group ${groupId}: ${groupError.message}`);
                errors.push({ groupId, error: groupError.message });
            }
        }

        res.json({
            success: true,
            message: `تم استخراج ${extractedCount} جهة اتصال من ${groupIds.length} مجموعة`,
            extractedCount,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        logDebug(`Fatal error: ${error.message}`);
        console.error('Error extracting from groups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/send-group-message
 * Send a message to multiple groups
 */
router.post('/send-group-message', async (req, res) => {
    try {
        const { groupIds, message } = req.body;

        if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ success: false, error: 'No groups selected' });
        }

        if (!message) {
            return res.status(400).json({ success: false, error: 'Message content is required' });
        }

        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
        }

        const waClient = whatsappManager.getClient(activeProfileId);
        if (!waClient || !waClient.client) {
            return res.status(500).json({ success: false, error: 'WhatsApp client not ready' });
        }

        let sentCount = 0;
        let errors = [];

        logDebug(`Broadcasting message to ${groupIds.length} groups...`);

        for (const groupId of groupIds) {
            try {
                // Determine format
                const chatId = groupId.includes('@') ? groupId : `${groupId}@g.us`;

                await waClient.client.sendMessage(chatId, message);
                sentCount++;

                // Add explicit delay between sends to avoid spam flagging
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

            } catch (err) {
                logDebug(`Error sending to group ${groupId}: ${err.message}`);
                errors.push({ groupId, error: err.message });
            }
        }

        res.json({
            success: true,
            message: `تم إرسال الرسالة إلى ${sentCount} مجموعة من أصل ${groupIds.length}`,
            sentCount,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        logDebug(`Fatal error in broadcast: ${error.message}`);
        console.error('Error broadcasting to groups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/extract-history
 * Extract contacts from message history (people who messaged before)
 */
router.post('/extract-history', async (req, res) => {
    try {
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
        }

        const { pool } = require('../config/database');

        // Get unique phone numbers from messages that are NOT from me (incoming messages)
        const result = await pool.query(`
            SELECT DISTINCT 
                from_number as phone,
                MAX(from_name) as name,
                chat_id
            FROM messages 
            WHERE client_id = $1 
              AND is_from_me = false 
              AND from_number IS NOT NULL
              AND chat_id NOT LIKE '%@g.us'
            GROUP BY from_number, chat_id
        `, [parseInt(activeProfileId)]);

        let extractedCount = 0;

        for (const row of result.rows) {
            try {
                const phoneNumber = row.phone.replace('@c.us', '').replace('@s.whatsapp.net', '');
                const contactId = row.phone.includes('@') ? row.phone : `${phoneNumber}@c.us`;

                await Contact.upsert({
                    client_id: parseInt(activeProfileId),
                    contact_id: contactId,
                    phone_number: phoneNumber,
                    name: row.name,
                    push_name: row.name,
                    short_name: null,
                    is_business: false,
                    is_blocked: false,
                    is_my_contact: false,
                    source: 'Chat History',
                    tags: JSON.stringify(['extracted', 'history'])
                });
                extractedCount++;
            } catch (e) {
                // Skip individual errors
            }
        }

        res.json({
            success: true,
            message: `تم استخراج ${extractedCount} جهة اتصال من سجل المحادثات`,
            extractedCount
        });
    } catch (error) {
        console.error('Error extracting from history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/contacts/extract-whatsapp
 * Extract ALL contacts from WhatsApp directly (tries multiple methods)
 */
router.post('/extract-whatsapp', async (req, res) => {
    try {
        const requestedProfileId = req.query.profileId || req.body.profileId;
        const allStatus = whatsappManager.getAllStatus();
        let activeProfileId;

        if (requestedProfileId) {
            const reqId = parseInt(requestedProfileId);
            if (allStatus[reqId] && allStatus[reqId].connected) {
                activeProfileId = reqId;
            } else {
                return res.status(400).json({ success: false, error: 'الجهاز المحدد غير متصل' });
            }
        } else {
            activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
        }

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
        }

        const waClient = whatsappManager.getClient(parseInt(activeProfileId));
        let extractedCount = 0;
        let method = '';
        let chatIds = [];

        // Method 1: Try to get chats via internal store (pupPage.evaluate)
        try {
            console.log('Trying Method 1: Internal WhatsApp Store...');
            const storeChats = await waClient.pupPage.evaluate(() => {
                if (window.Store && window.Store.Chat) {
                    return window.Store.Chat.getModelsArray().map(chat => ({
                        id: chat.id._serialized,
                        name: chat.name || chat.formattedTitle || chat.contact?.pushname || null,
                        isGroup: chat.isGroup
                    }));
                }
                return [];
            });

            if (storeChats && storeChats.length > 0) {
                method = 'WhatsApp Internal Store';
                for (const chat of storeChats) {
                    if (!chat.isGroup && chat.id) {
                        chatIds.push({ id: chat.id, name: chat.name });
                    }
                }
            }
        } catch (e) {
            console.log('Method 1 failed:', e.message);
        }

        // Method 2: If Method 1 failed, try getContacts and filter those with chats
        if (chatIds.length === 0) {
            try {
                console.log('Trying Method 2: getContacts...');
                const contacts = await waClient.getContacts();
                method = 'WhatsApp Contacts';

                // Get contacts that are users (not groups, not broadcast)
                for (const contact of contacts) {
                    if (contact.isUser && !contact.isGroup && contact.id._serialized) {
                        chatIds.push({
                            id: contact.id._serialized,
                            name: contact.name || contact.pushname || null
                        });
                    }
                }
            } catch (e) {
                console.log('Method 2 failed:', e.message);
            }
        }

        // Method 3: Last resort - try getChats (might fail but worth trying)
        if (chatIds.length === 0) {
            try {
                console.log('Trying Method 3: getChats...');
                const chats = await waClient.getChats();
                method = 'WhatsApp Chats';

                for (const chat of chats) {
                    if (!chat.isGroup) {
                        chatIds.push({
                            id: chat.id._serialized,
                            name: chat.name || null
                        });
                    }
                }
            } catch (e) {
                console.log('Method 3 failed:', e.message);
            }
        }

        // Save extracted contacts
        console.log(`Found ${chatIds.length} potential contacts via ${method}`);

        for (const chat of chatIds) {
            try {
                const phoneNumber = chat.id.replace('@c.us', '').replace('@s.whatsapp.net', '');

                // Skip if it looks like a group or broadcast
                if (chat.id.includes('@g.us') || chat.id.includes('@broadcast')) {
                    continue;
                }

                await Contact.upsert({
                    client_id: parseInt(activeProfileId),
                    contact_id: chat.id,
                    phone_number: phoneNumber,
                    name: chat.name,
                    push_name: chat.name,
                    short_name: null,
                    is_business: false,
                    is_blocked: false,
                    is_my_contact: false,
                    source: `WhatsApp Import (${method})`,
                    tags: JSON.stringify(['imported'])
                });
                extractedCount++;
            } catch (e) {
                // Skip individual errors
            }
        }

        res.json({
            success: true,
            message: `تم استخراج ${extractedCount} جهة اتصال من واتساب (${method})`,
            extractedCount,
            method
        });
    } catch (error) {
        console.error('Error extracting from WhatsApp:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
