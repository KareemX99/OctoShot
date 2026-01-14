/**
 * Migration: Add labels column to campaign_enrollments table
 * Run: node scripts/addEnrollmentLabels.js
 */

const { pool } = require('../config/database');

async function addLabelsColumn() {
    try {
        console.log('🔄 Adding labels column to campaign_enrollments...');

        await pool.query(`
            ALTER TABLE campaign_enrollments 
            ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]'::jsonb
        `);

        console.log('✅ Labels column added successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

addLabelsColumn();
