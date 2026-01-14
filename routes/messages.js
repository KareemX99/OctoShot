/**
 * Messages Routes
 * API endpoints for message operations
 */

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
// Note: getClient was removed - use whatsappManager if WhatsApp client access needed

/**
 * GET /api/messages
 * Get all chats with last message
 */
router.get('/', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const chats = await Message.getChatsWithLastMessage(clientId);
        res.json({ success: true, data: chats });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/messages/stats
 * Get message statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const stats = await Message.getStats(clientId);
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/messages/recent
 * Get recent messages
 */
router.get('/recent', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const limit = parseInt(req.query.limit) || 10;
        const messages = await Message.getRecent(clientId, limit);
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Error fetching recent messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/messages/chat/:chatId
 * Get messages for a specific chat
 */
router.get('/chat/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const messages = await Message.getByChatId(chatId, limit, offset);
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Error fetching chat messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/messages/search
 * Search messages
 */
router.get('/search', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({ success: false, error: 'Search query required' });
        }

        const messages = await Message.search(clientId, q);
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Error searching messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
