/**
 * Contacts Routes
 * API endpoints for contact operations
 */

const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const whatsappManager = require('../whatsapp-manager');

/**
 * GET /api/contacts
 * Get all contacts
 */
router.get('/', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;

        const contacts = await Contact.getAll(clientId, limit, offset);
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
        const clientId = req.query.clientId || 1;
        const stats = await Contact.getCount(clientId);
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching contact stats:', error);
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
        const clientId = req.query.clientId || 1;

        // Get WhatsApp client from first connected profile
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(pid => allStatus[pid].connected);
        const waClient = activeProfileId ? whatsappManager.getClient(parseInt(activeProfileId)) : null;

        if (!waClient) {
            return res.status(400).json({ success: false, error: 'WhatsApp not connected' });
        }

        const waContacts = await waClient.getContacts();
        let synced = 0;

        for (const contact of waContacts) {
            if (contact.isUser && contact.id._serialized) {
                await Contact.upsert({
                    client_id: clientId,
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
        }

        res.json({ success: true, message: `Synced ${synced} contacts` });
    } catch (error) {
        console.error('Error syncing contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
