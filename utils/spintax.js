/**
 * Spintax Utility
 * Parses and resolves {option1|option2|option3} syntax
 */

/**
 * Resolve spintax in a string
 * @param {string} text - Text with spintax syntax
 * @returns {string} - Resolved text with random selections
 */
function resolve(text) {
    if (!text) return text;

    // Regex to match {option1|option2|...}
    const spintaxRegex = /\{([^{}]+)\}/g;

    let result = text;
    let match;

    // Keep resolving until no more spintax found (handles nested)
    while ((match = spintaxRegex.exec(result)) !== null) {
        const options = match[1].split('|');
        const randomOption = options[Math.floor(Math.random() * options.length)];
        result = result.replace(match[0], randomOption);
        spintaxRegex.lastIndex = 0; // Reset regex
    }

    return result;
}

/**
 * Count total variations possible in spintax text
 * @param {string} text - Text with spintax syntax
 * @returns {number} - Number of possible variations
 */
function countVariations(text) {
    if (!text) return 1;

    const spintaxRegex = /\{([^{}]+)\}/g;
    let count = 1;
    let match;

    while ((match = spintaxRegex.exec(text)) !== null) {
        const options = match[1].split('|');
        count *= options.length;
    }

    return count;
}

/**
 * Check if text contains spintax
 * @param {string} text - Text to check
 * @returns {boolean}
 */
function hasSpintax(text) {
    if (!text) return false;
    return /\{[^{}]+\}/.test(text);
}

/**
 * Generate multiple unique variations
 * @param {string} text - Text with spintax
 * @param {number} count - Number of variations to generate
 * @returns {string[]} - Array of resolved variations
 */
function generateVariations(text, count) {
    const variations = new Set();
    const maxVariations = countVariations(text);
    const targetCount = Math.min(count, maxVariations);

    // Try to generate unique variations
    let attempts = 0;
    const maxAttempts = targetCount * 10;

    while (variations.size < targetCount && attempts < maxAttempts) {
        variations.add(resolve(text));
        attempts++;
    }

    return Array.from(variations);
}

module.exports = {
    resolve,
    countVariations,
    hasSpintax,
    generateVariations
};
