/**
 * Admin Logs Routes
 * Secure endpoints for viewing profile logs with email/password auth
 */

const express = require('express');
const router = express.Router();
const ProfileLogger = require('../services/ProfileLogger');

// Get credentials from environment
const ADMIN_EMAIL = process.env.LOGS_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.LOGS_ADMIN_PASSWORD;

// Simple session storage (in production, use proper session management)
const activeSessions = new Map();

/**
 * Generate a simple session token
 */
function generateToken() {
    return 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Auth middleware
 */
function requireAuth(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.token;

    if (!token || !activeSessions.has(token)) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized. Please login first.'
        });
    }

    // Check token expiry (24 hours)
    const session = activeSessions.get(token);
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        activeSessions.delete(token);
        return res.status(401).json({
            success: false,
            error: 'Session expired. Please login again.'
        });
    }

    req.adminSession = session;
    next();
}

/**
 * POST /api/admin/login
 * Login with email and password
 */
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        return res.status(500).json({
            success: false,
            error: 'Admin credentials not configured. Add LOGS_ADMIN_EMAIL and LOGS_ADMIN_PASSWORD to .env'
        });
    }

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            error: 'Invalid email or password'
        });
    }

    // Create session
    const token = generateToken();
    activeSessions.set(token, {
        email: email,
        createdAt: Date.now()
    });

    console.log(`🔐 Admin logged in: ${email}`);

    res.json({
        success: true,
        token: token,
        message: 'Login successful'
    });
});

/**
 * POST /api/admin/logout
 * Logout and invalidate token
 */
router.post('/logout', requireAuth, (req, res) => {
    const token = req.headers['x-admin-token'] || req.query.token;
    activeSessions.delete(token);

    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

/**
 * GET /api/admin/verify
 * Verify if current token is valid
 */
router.get('/verify', requireAuth, (req, res) => {
    res.json({
        success: true,
        email: req.adminSession.email
    });
});

/**
 * GET /api/admin/logs
 * Get logs with filtering and pagination
 */
router.get('/logs', requireAuth, async (req, res) => {
    try {
        const {
            client_id,
            log_type,
            log_level,
            since,
            limit = 100,
            offset = 0
        } = req.query;

        const logs = await ProfileLogger.getRecentLogs(
            client_id ? parseInt(client_id) : null,
            parseInt(limit),
            parseInt(offset),
            {
                logType: log_type,
                logLevel: log_level,
                since: since
            }
        );

        res.json({
            success: true,
            logs: logs,
            count: logs.length
        });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/logs/stats
 * Get log statistics
 */
router.get('/logs/stats', requireAuth, async (req, res) => {
    try {
        const { client_id, time_window = '24 hours' } = req.query;

        const stats = await ProfileLogger.getStats(
            client_id ? parseInt(client_id) : null,
            time_window
        );

        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/logs/types
 * Get available log types
 */
router.get('/logs/types', requireAuth, (req, res) => {
    res.json({
        success: true,
        types: ProfileLogger.LOG_TYPES,
        levels: ProfileLogger.LOG_LEVELS
    });
});

/**
 * GET /api/admin/sessions
 * Get all stored sessions info (local files)
 */
router.get('/sessions', requireAuth, async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const backupFolder = path.join(__dirname, '..', '.wwebjs_sessions_backup');

        let sessions = [];
        if (fs.existsSync(backupFolder)) {
            const files = fs.readdirSync(backupFolder).filter(f => f.endsWith('.tar.gz'));
            sessions = files.map(f => {
                const stats = fs.statSync(path.join(backupFolder, f));
                return {
                    session_id: f.replace('.tar.gz', ''),
                    file_path: path.join(backupFolder, f),
                    size_bytes: stats.size,
                    updated_at: stats.mtime
                };
            });
        }

        res.json({
            success: true,
            sessions: sessions,
            count: sessions.length
        });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/profiles
 * Get all WhatsApp profiles from database for dropdown filter
 */
router.get('/profiles', requireAuth, async (req, res) => {
    try {
        const { pool } = require('../config/database');
        const { search } = req.query;

        let query = `
            SELECT id, uuid, device_name, phone_number, status, 
                   created_at, updated_at, push_name, platform
            FROM clients 
        `;

        let values = [];
        if (search) {
            query += `
                WHERE uuid ILIKE $1
                   OR device_name ILIKE $1
                   OR phone_number ILIKE $1
                   OR push_name ILIKE $1
            `;
            values.push(`%${search}%`);
        }

        query += ` ORDER BY device_name`;

        const result = await pool.query(query, values);

        res.json({
            success: true,
            profiles: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('Error fetching profiles:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/profile/:id/history
 * Get connection history for a specific profile
 */
router.get('/profile/:id/history', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const logs = await ProfileLogger.getRecentLogs(
            parseInt(id),
            50,
            0,
            { logType: 'connection' }
        );

        res.json({
            success: true,
            history: logs
        });
    } catch (error) {
        console.error('Error fetching profile history:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Setup Socket.IO authentication for admin room
 */
function setupSocketAuth(io) {
    io.on('connection', (socket) => {
        // Join admin-logs room if authenticated
        socket.on('join-admin-logs', (token) => {
            if (activeSessions.has(token)) {
                socket.join('admin-logs');
                socket.emit('admin-logs-joined', { success: true });
                console.log(`🔌 Admin socket joined logs room`);
            } else {
                socket.emit('admin-logs-joined', { success: false, error: 'Invalid token' });
            }
        });

        socket.on('leave-admin-logs', () => {
            socket.leave('admin-logs');
        });
    });
}

module.exports = router;
module.exports.setupSocketAuth = setupSocketAuth;
