/**
 * Campaign Model
 * Handles database operations for campaigns and campaign steps
 */

const { pool } = require('../config/database');

class Campaign {
    /**
     * Create a new campaign with multi-device support
     */
    static async create(data) {
        // Handle device_ids array for round-robin
        const deviceIds = data.device_ids || (data.device_id ? [data.device_id] : []);
        const primaryDeviceId = data.device_id || deviceIds[0];

        const query = `
            INSERT INTO campaigns (
                device_id, device_ids, name, type, status,
                scheduled_at, operating_hours_start, operating_hours_end,
                operating_days, timezone, trust_level,
                min_delay_seconds, max_delay_seconds, daily_limit
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `;

        const values = [
            primaryDeviceId,
            deviceIds,
            data.name,
            data.type || 'single',
            data.status || 'draft',
            data.scheduled_at || null,
            data.operating_hours_start || '09:00',
            data.operating_hours_end || '21:00',
            data.operating_days || [0, 1, 2, 3, 4, 5, 6],
            data.timezone || 'Africa/Cairo',
            data.trust_level || 1,
            data.min_delay_seconds || 15,
            data.max_delay_seconds || 45,
            data.daily_limit || 300
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Get campaign by ID
     */
    static async getById(id) {
        const query = `
            SELECT c.*, 
                   COUNT(DISTINCT ce.id) as enrollment_count,
                   json_agg(
                       json_build_object(
                           'id', cs.id,
                           'step_order', cs.step_order,
                           'message_type', cs.message_type,
                           'content', cs.content,
                           'media_url', cs.media_url,
                           'filename', cs.filename,
                           'delay_seconds', cs.delay_seconds,
                           'use_spintax', cs.use_spintax
                       ) ORDER BY cs.step_order
                   ) FILTER (WHERE cs.id IS NOT NULL) as steps
            FROM campaigns c
            LEFT JOIN campaign_steps cs ON c.id = cs.campaign_id
            LEFT JOIN campaign_enrollments ce ON c.id = ce.campaign_id
            WHERE c.id = $1
            GROUP BY c.id
        `;

        const result = await pool.query(query, [id]);
        return result.rows[0] || null;
    }

    /**
     * Get campaign by UUID
     */
    static async getByUUID(uuid) {
        const result = await pool.query(
            'SELECT * FROM campaigns WHERE uuid = $1',
            [uuid]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all campaigns for a device
     */
    static async getAll(deviceId, filters = {}) {
        let query = `
            SELECT c.*,
                   (SELECT COUNT(*) FROM campaign_enrollments WHERE campaign_id = c.id) as enrollment_count,
                   (SELECT COUNT(*) FROM campaign_steps WHERE campaign_id = c.id) as step_count
            FROM campaigns c
            WHERE c.device_id = $1
        `;
        const values = [deviceId];
        let paramIndex = 2;

        if (filters.status) {
            query += ` AND c.status = $${paramIndex++}`;
            values.push(filters.status);
        }

        if (filters.type) {
            query += ` AND c.type = $${paramIndex++}`;
            values.push(filters.type);
        }

        query += ` ORDER BY c.created_at DESC`;

        if (filters.limit) {
            query += ` LIMIT $${paramIndex++}`;
            values.push(filters.limit);
        }

        if (filters.offset) {
            query += ` OFFSET $${paramIndex++}`;
            values.push(filters.offset);
        }

        const result = await pool.query(query, values);
        return result.rows;
    }

    /**
     * Update campaign
     */
    static async update(id, data) {
        const allowedFields = [
            'name', 'status', 'scheduled_at',
            'operating_hours_start', 'operating_hours_end',
            'operating_days', 'timezone', 'trust_level',
            'min_delay_seconds', 'max_delay_seconds', 'daily_limit'
        ];

        const updates = [];
        const values = [id];
        let paramIndex = 2;

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updates.push(`${field} = $${paramIndex++}`);
                values.push(data[field]);
            }
        }

        if (updates.length === 0) return this.getById(id);

        const query = `
            UPDATE campaigns 
            SET ${updates.join(', ')}
            WHERE id = $1
            RETURNING *
        `;

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Delete campaign
     */
    static async delete(id) {
        const result = await pool.query(
            'DELETE FROM campaigns WHERE id = $1 RETURNING *',
            [id]
        );
        return result.rows[0];
    }

    // ==================== STEPS ====================

    /**
     * Add step to campaign
     */
    static async addStep(campaignId, data) {
        // Get max step order
        const maxOrderResult = await pool.query(
            'SELECT COALESCE(MAX(step_order), 0) as max_order FROM campaign_steps WHERE campaign_id = $1',
            [campaignId]
        );
        const nextOrder = maxOrderResult.rows[0].max_order + 1;

        if (nextOrder > 5) {
            throw new Error('Maximum 5 steps allowed per campaign');
        }

        const query = `
            INSERT INTO campaign_steps (
                campaign_id, step_order, message_type, content,
                media_url, filename, delay_seconds, use_spintax
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

        const values = [
            campaignId,
            data.step_order || nextOrder,
            data.message_type,
            data.content || null,
            data.media_url || null,
            data.filename || null,
            data.delay_seconds || 0,
            data.use_spintax || false
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Update step
     */
    static async updateStep(stepId, data) {
        const allowedFields = [
            'message_type', 'content', 'media_url',
            'filename', 'delay_seconds', 'use_spintax'
        ];

        const updates = [];
        const values = [stepId];
        let paramIndex = 2;

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updates.push(`${field} = $${paramIndex++}`);
                values.push(data[field]);
            }
        }

        if (updates.length === 0) return null;

        const query = `
            UPDATE campaign_steps 
            SET ${updates.join(', ')}
            WHERE id = $1
            RETURNING *
        `;

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Remove step
     */
    static async removeStep(stepId) {
        const result = await pool.query(
            'DELETE FROM campaign_steps WHERE id = $1 RETURNING *',
            [stepId]
        );
        return result.rows[0];
    }

    /**
     * Get all steps for a campaign
     */
    static async getSteps(campaignId) {
        const result = await pool.query(
            'SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_order',
            [campaignId]
        );
        return result.rows;
    }

    // ==================== ENROLLMENTS ====================

    /**
     * Add recipients to campaign
     */
    static async addRecipients(campaignId, recipients) {
        const results = [];

        for (const recipient of recipients) {
            try {
                const query = `
                    INSERT INTO campaign_enrollments (
                        campaign_id, recipient, recipient_name, attributes, status
                    ) VALUES ($1, $2, $3, $4, 'pending')
                    ON CONFLICT (campaign_id, recipient) DO NOTHING
                    RETURNING *
                `;

                const values = [
                    campaignId,
                    recipient.phone || recipient,
                    recipient.name || null,
                    recipient.attributes || {}
                ];

                const result = await pool.query(query, values);
                if (result.rows[0]) {
                    results.push(result.rows[0]);
                }
            } catch (error) {
                console.error(`Error adding recipient ${recipient}:`, error.message);
            }
        }

        // Update total_recipients count
        await pool.query(`
            UPDATE campaigns 
            SET total_recipients = (
                SELECT COUNT(*) FROM campaign_enrollments WHERE campaign_id = $1
            )
            WHERE id = $1
        `, [campaignId]);

        return results;
    }

    /**
     * Get enrollments for a campaign with message delivery status
     */
    static async getEnrollments(campaignId, filters = {}) {
        let query = `
            SELECT 
                ce.*,
                cml.sent_at,
                cml.delivered_at,
                cml.read_at,
                cml.status as message_status,
                cml.error_message,
                c.device_name,
                c.phone_number as assigned_device_phone
            FROM campaign_enrollments ce
            LEFT JOIN campaign_message_log cml ON ce.id = cml.enrollment_id
            LEFT JOIN clients c ON ce.assigned_device_id = c.id
            WHERE ce.campaign_id = $1
        `;
        const values = [campaignId];
        let paramIndex = 2;

        if (filters.status) {
            query += ` AND ce.status = $${paramIndex++}`;
            values.push(filters.status);
        }

        query += ` ORDER BY ce.next_execution_at NULLS LAST, ce.created_at`;

        if (filters.limit) {
            query += ` LIMIT $${paramIndex++}`;
            values.push(filters.limit);
        }

        const result = await pool.query(query, values);
        return result.rows;
    }

    // ==================== CAMPAIGN CONTROL ====================

    /**
     * Start a campaign
     */
    static async start(id) {
        const result = await pool.query(`
            UPDATE campaigns 
            SET status = 'running', started_at = NOW()
            WHERE id = $1 AND status IN ('draft', 'scheduled', 'paused')
            RETURNING *
        `, [id]);
        return result.rows[0];
    }

    /**
     * Pause a campaign
     */
    static async pause(id) {
        const result = await pool.query(`
            UPDATE campaigns 
            SET status = 'paused'
            WHERE id = $1 AND status = 'running'
            RETURNING *
        `, [id]);
        return result.rows[0];
    }

    /**
     * Resume a campaign
     */
    static async resume(id) {
        const result = await pool.query(`
            UPDATE campaigns 
            SET status = 'running'
            WHERE id = $1 AND status = 'paused'
            RETURNING *
        `, [id]);
        return result.rows[0];
    }

    /**
     * Cancel a campaign
     */
    static async cancel(id) {
        const result = await pool.query(`
            UPDATE campaigns 
            SET status = 'cancelled', completed_at = NOW()
            WHERE id = $1 AND status IN ('draft', 'scheduled', 'running', 'paused')
            RETURNING *
        `, [id]);
        return result.rows[0];
    }

    // ==================== STATISTICS ====================

    /**
     * Get campaign statistics with all counts
     */
    static async getStats(id) {
        const result = await pool.query(`
            SELECT 
                c.total_recipients,
                COALESCE(c.sent_count, 0) as sent_count,
                COALESCE(c.delivered_count, 0) as delivered_count,
                COALESCE(c.read_count, 0) as read_count,
                COALESCE(c.failed_count, 0) as failed_count,
                COUNT(ce.id) FILTER (WHERE ce.status = 'pending') as pending_count,
                COUNT(ce.id) FILTER (WHERE ce.status = 'active') as active_count,
                COUNT(ce.id) FILTER (WHERE ce.status = 'completed') as completed_count,
                COUNT(ce.id) FILTER (WHERE ce.status = 'failed') as failed_enrollment_count
            FROM campaigns c
            LEFT JOIN campaign_enrollments ce ON c.id = ce.campaign_id
            WHERE c.id = $1
            GROUP BY c.id
        `, [id]);

        return result.rows[0] || null;
    }

    /**
     * Update campaign progress counts
     */
    static async updateProgress(id, field, increment = 1) {
        const allowedFields = ['sent_count', 'delivered_count', 'read_count', 'failed_count'];
        if (!allowedFields.includes(field)) return;

        await pool.query(`
            UPDATE campaigns 
            SET ${field} = ${field} + $1
            WHERE id = $2
        `, [increment, id]);
    }

    /**
     * Mark campaign as completed
     */
    static async markCompleted(id) {
        const result = await pool.query(`
            UPDATE campaigns 
            SET status = 'completed', completed_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [id]);
        return result.rows[0];
    }

    // ==================== QUEUE HELPER METHODS ====================

    /**
     * Get enrollment by ID
     */
    static async getEnrollmentById(enrollmentId) {
        const result = await pool.query(
            'SELECT * FROM campaign_enrollments WHERE id = $1',
            [enrollmentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get step by order
     */
    static async getStepByOrder(campaignId, stepOrder) {
        const result = await pool.query(
            'SELECT * FROM campaign_steps WHERE campaign_id = $1 AND step_order = $2',
            [campaignId, stepOrder]
        );
        return result.rows[0] || null;
    }

    /**
     * Update enrollment step progress
     */
    static async updateEnrollmentStep(enrollmentId, stepNumber, jobId = null) {
        const result = await pool.query(`
            UPDATE campaign_enrollments 
            SET current_step = $1, 
                current_job_id = $2,
                last_execution_at = NOW()
            WHERE id = $3
            RETURNING *
        `, [stepNumber, jobId, enrollmentId]);
        return result.rows[0];
    }

    /**
     * Update enrollment status
     */
    static async updateEnrollmentStatus(enrollmentId, status) {
        const result = await pool.query(`
            UPDATE campaign_enrollments 
            SET status = $1
            WHERE id = $2
            RETURNING *
        `, [status, enrollmentId]);
        return result.rows[0];
    }

    /**
     * Set next execution time for an enrollment
     */
    static async setNextExecution(enrollmentId, nextExecutionAt) {
        const result = await pool.query(`
            UPDATE campaign_enrollments 
            SET next_execution_at = $1
            WHERE id = $2
            RETURNING *
        `, [nextExecutionAt, enrollmentId]);
        return result.rows[0];
    }

    /**
     * Get enrollments by status
     */
    static async getEnrollmentsByStatus(campaignId, status) {
        const result = await pool.query(
            'SELECT * FROM campaign_enrollments WHERE campaign_id = $1 AND status = $2',
            [campaignId, status]
        );
        return result.rows;
    }

    /**
     * Get next pending enrollment for a campaign (for sequential processing)
     * Returns the first pending enrollment assigned to the given device
     */
    static async getNextPendingEnrollment(campaignId, deviceId = null) {
        let query;
        let params;

        if (deviceId) {
            query = `SELECT * FROM campaign_enrollments 
                     WHERE campaign_id = $1 AND status = 'pending' AND assigned_device_id = $2
                     ORDER BY id ASC LIMIT 1`;
            params = [campaignId, deviceId];
        } else {
            query = `SELECT * FROM campaign_enrollments 
                     WHERE campaign_id = $1 AND status = 'pending'
                     ORDER BY id ASC LIMIT 1`;
            params = [campaignId];
        }

        const result = await pool.query(query, params);
        return result.rows[0] || null;
    }

    /**
     * Log message sent for an enrollment step
     */
    static async logMessageSent(enrollmentId, stepOrder, whatsappMessageId) {
        // Update step_statuses JSONB
        await pool.query(`
            UPDATE campaign_enrollments 
            SET step_statuses = COALESCE(step_statuses, '{}')::jsonb || $1::jsonb
            WHERE id = $2
        `, [JSON.stringify({ [stepOrder]: 'sent' }), enrollmentId]);

        // Insert into message log
        await pool.query(`
            INSERT INTO campaign_message_log (enrollment_id, step_order, status, whatsapp_message_id, sent_at)
            VALUES ($1, $2, 'sent', $3, NOW())
            ON CONFLICT DO NOTHING
        `, [enrollmentId, stepOrder, whatsappMessageId]);
    }

    /**
     * Log message failed for an enrollment step
     */
    static async logMessageFailed(enrollmentId, stepOrder, errorMessage) {
        // Update step_statuses JSONB
        await pool.query(`
            UPDATE campaign_enrollments 
            SET step_statuses = COALESCE(step_statuses, '{}')::jsonb || $1::jsonb
            WHERE id = $2
        `, [JSON.stringify({ [stepOrder]: 'failed' }), enrollmentId]);

        // Insert into message log
        await pool.query(`
            INSERT INTO campaign_message_log (enrollment_id, step_order, status, error_message)
            VALUES ($1, $2, 'failed', $3)
            ON CONFLICT DO NOTHING
        `, [enrollmentId, stepOrder, errorMessage]);
    }

    /**
     * Increment sent count
     */
    static async incrementSentCount(campaignId) {
        await pool.query(`
            UPDATE campaigns 
            SET sent_count = sent_count + 1
            WHERE id = $1
        `, [campaignId]);
    }

    /**
     * Increment failed count
     */
    static async incrementFailedCount(campaignId) {
        await pool.query(`
            UPDATE campaigns 
            SET failed_count = failed_count + 1
            WHERE id = $1
        `, [campaignId]);
    }

    /**
     * Set started_at timestamp
     */
    static async setStartedAt(campaignId) {
        await pool.query(`
            UPDATE campaigns 
            SET started_at = NOW()
            WHERE id = $1
        `, [campaignId]);
    }

    /**
     * Update campaign status  
     */
    static async updateStatus(campaignId, status) {
        const result = await pool.query(`
            UPDATE campaigns 
            SET status = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `, [status, campaignId]);
        return result.rows[0];
    }

    /**
     * Update message ACK status (delivered/read) by WhatsApp message ID
     * Returns campaign_id if found, null otherwise
     */
    static async updateMessageAck(whatsappMessageId, newStatus, ackLevel) {
        // Ensure ackLevel is an integer
        const ackLevelInt = parseInt(ackLevel) || 0;

        // Update message log and get campaign_id through enrollment
        const result = await pool.query(`
            UPDATE campaign_message_log cml
            SET status = $1, ack_level = $2,
                delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
                read_at = CASE WHEN $1 = 'read' THEN NOW() ELSE read_at END
            FROM campaign_enrollments ce
            WHERE cml.enrollment_id = ce.id
              AND cml.whatsapp_message_id = $3
              AND (cml.status != 'read' OR $1 = 'read')
            RETURNING cml.id, ce.campaign_id
        `, [newStatus, ackLevelInt, whatsappMessageId]);

        if (result.rows.length > 0) {
            return result.rows[0].campaign_id;
        }
        return null;
    }

    /**
     * Increment delivered count
     */
    static async incrementDeliveredCount(campaignId) {
        await pool.query(`
            UPDATE campaigns 
            SET delivered_count = COALESCE(delivered_count, 0) + 1
            WHERE id = $1
        `, [campaignId]);
    }

    /**
     * Increment read count
     */
    static async incrementReadCount(campaignId) {
        await pool.query(`
            UPDATE campaigns 
            SET read_count = COALESCE(read_count, 0) + 1
            WHERE id = $1
        `, [campaignId]);
    }

    /**
     * Get campaign quick stats (sent/delivered/read/failed)
     */
    static async getQuickStats(campaignId) {
        const result = await pool.query(`
            SELECT 
                COALESCE(sent_count, 0) as sent_count,
                COALESCE(delivered_count, 0) as delivered_count,
                COALESCE(read_count, 0) as read_count,
                COALESCE(failed_count, 0) as failed_count
            FROM campaigns
            WHERE id = $1
        `, [campaignId]);
        return result.rows[0];
    }

    /**
     * Assign a device to an enrollment for round-robin tracking
     */
    static async assignDeviceToEnrollment(enrollmentId, deviceId) {
        const result = await pool.query(`
            UPDATE campaign_enrollments 
            SET assigned_device_id = $1
            WHERE id = $2
            RETURNING *
        `, [deviceId, enrollmentId]);
        return result.rows[0];
    }

    /**
     * Get per-device stats for a campaign
     * Returns breakdown of sent/delivered/read/failed per device
     */
    static async getPerDeviceStats(campaignId) {
        const result = await pool.query(`
            SELECT 
                ce.assigned_device_id as device_id,
                c.phone_number as device_phone,
                c.device_name as device_name,
                COUNT(ce.id) as total_assigned,
                COUNT(cml.id) FILTER (WHERE cml.status = 'sent') as sent,
                COUNT(cml.id) FILTER (WHERE cml.status = 'delivered') as delivered,
                COUNT(cml.id) FILTER (WHERE cml.status = 'read') as read,
                COUNT(cml.id) FILTER (WHERE cml.status = 'failed') as failed,
                COUNT(ce.id) FILTER (WHERE ce.status = 'pending') as pending,
                COUNT(ce.id) FILTER (WHERE ce.status = 'active') as active,
                COUNT(ce.id) FILTER (WHERE ce.status = 'completed') as completed
            FROM campaign_enrollments ce
            LEFT JOIN campaign_message_log cml ON ce.id = cml.enrollment_id
            LEFT JOIN clients c ON ce.assigned_device_id = c.id
            WHERE ce.campaign_id = $1 AND ce.assigned_device_id IS NOT NULL
            GROUP BY ce.assigned_device_id, c.phone_number, c.device_name
            ORDER BY ce.assigned_device_id
        `, [campaignId]);
        return result.rows;
    }

    /**
     * Get today's sent count for a specific device
     * Used to enforce per-device daily limits
     */
    static async getTodaySentCountByDevice(deviceId) {
        const result = await pool.query(`
            SELECT COUNT(*) as count
            FROM campaign_message_log cml
            JOIN campaign_enrollments ce ON cml.enrollment_id = ce.id
            WHERE ce.assigned_device_id = $1
              AND cml.sent_at >= CURRENT_DATE
              AND cml.status IN ('sent', 'delivered', 'read')
        `, [deviceId]);
        return parseInt(result.rows[0].count) || 0;
    }
}

module.exports = Campaign;

