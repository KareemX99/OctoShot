/**
 * Spintax Generator Routes
 * AI-powered spintax generation using OpenAI
 */

const express = require('express');
const router = express.Router();

// OpenAI API key from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * POST /api/spintax/generate
 * Generate spintax from text using OpenAI
 */
router.post('/generate', async (req, res) => {
    try {
        const { text, variations = 5 } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please provide text to convert'
            });
        }

        if (!OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to .env file'
            });
        }

        // Clamp variations between 5 and 30
        const numVariations = Math.min(10, Math.max(3, parseInt(variations) || 5));

        const prompt = `Number of Variations per word: ${numVariations}

Original Text:
${text}

Convert the above text to Spintax format with ${numVariations} alternatives for each significant word.`;

        // Call OpenAI API with GPT-4o for better Arabic understanding
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert in creating humanistic Spintax for Egyptian colloquial Arabic (عامية مصرية) marketing messages. Your primary goal is to generate variations that sound like a real Egyptian person having a friendly conversation with a customer.

Core Guidelines:
- Use ONLY Egyptian colloquial Arabic (العامية المصرية), NOT formal/classical Arabic (الفصحى)
- Write as if you're a friendly Egyptian salesperson talking one-on-one with a customer
- Use respectful singular pronouns (ضمائر المخاطب للمفرد العام) - addressing one person politely
- Include natural Egyptian conversational phrases and fillers

Language Requirements:
- Include Egyptian greetings: "ازيك", "اي الاخبار", "اخبارك ايه"
- Use respectful addresses: "حضرتك", "يا فندم", "يا استاذ"
- Add conversational elements: "اي رايك", "تعرف ايه", "مش كده ولا ايه", "بجد والله"
- Use Egyptian expressions: "يلا", "خلاص", "تمام", "كده", "دلوقتي", "النهاردة"
- AVOID Gulf dialect completely (no يا هلا، ما شاء الله in Gulf context)

Spintax Technical Rules:
- Format: {option1|option2|option3}
- NEVER change: Numbers, URLs, store names, emojis (👋🎅🎄🎁😍❤)
- Each variation must sound naturally Egyptian and conversational
- Maintain the marketing enthusiasm but in an Egyptian friendly way
- Return ONLY the final Spintax text without explanation

Humanistic Approach:
- Write variations as if you're talking to a neighbor or friend
- Use warm, personal language that Egyptians use daily
- Include phrases that show care: "ان شاء الله تستفيد", "ربنا يوفقك", "يارب تعجبك"
- Add Egyptian enthusiasm: "حاجة تحفة", "فرصة جامدة", "عرض نار", "سعر خيالي"

Examples of Good Egyptian Variations:
- Greetings: {ازيك يا فندم|اخبارك ايه|ايه يا عم انت فين|سلام عليكم ازي حضرتك}
- Excitement: {عندي ليك حاجة تحفة|بص بقى عندنا عرض نار|تعالى اقولك على حاجة جامدة}
- Closing: {يلا مستنيك|تعالى بسرعة|الحق قبل ما يخلص}`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 3000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('OpenAI API error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to generate spintax. Please try again.'
            });
        }

        const data = await response.json();
        const spintax = data.choices[0]?.message?.content?.trim();

        if (!spintax) {
            return res.status(500).json({
                success: false,
                error: 'No spintax generated'
            });
        }

        console.log(`✨ Spintax generated for: "${text.substring(0, 50)}..."`);

        res.json({
            success: true,
            spintax: spintax,
            original: text,
            variations: numVariations
        });

    } catch (error) {
        console.error('Spintax generation error:', error);
        res.status(500).json({
            success: false,
            error: 'An error occurred while generating spintax'
        });
    }
});

/**
 * POST /api/spintax/expand
 * Expand spintax to preview variations
 */
router.post('/expand', (req, res) => {
    try {
        const { spintax, count = 5 } = req.body;

        if (!spintax) {
            return res.status(400).json({
                success: false,
                error: 'Please provide spintax text'
            });
        }

        const numCount = Math.min(20, Math.max(1, parseInt(count) || 5));
        const variations = [];

        for (let i = 0; i < numCount; i++) {
            const expanded = expandSpintax(spintax);
            if (!variations.includes(expanded)) {
                variations.push(expanded);
            }
        }

        // If we got duplicates, try to get more unique ones
        let attempts = 0;
        while (variations.length < numCount && attempts < 50) {
            const expanded = expandSpintax(spintax);
            if (!variations.includes(expanded)) {
                variations.push(expanded);
            }
            attempts++;
        }

        res.json({
            success: true,
            variations: variations,
            count: variations.length
        });

    } catch (error) {
        console.error('Spintax expand error:', error);
        res.status(500).json({
            success: false,
            error: 'An error occurred while expanding spintax'
        });
    }
});

/**
 * Expand spintax text by randomly selecting from each option group
 */
function expandSpintax(text) {
    const regex = /\{([^{}]+)\}/g;
    return text.replace(regex, (match, options) => {
        const choices = options.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
    });
}

module.exports = router;
