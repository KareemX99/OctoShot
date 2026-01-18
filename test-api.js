// Test the API endpoint directly for Kiko chat
const http = require('http');

const chatId = '201070212481@c.us';
const PORT = 3031;
const url = `http://localhost:${PORT}/api/messages/chat/${encodeURIComponent(chatId)}?limit=50`;

console.log(`Testing API: ${url}\n`);

http.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log(`Success: ${json.success}`);
            console.log(`Messages count: ${json.data?.length || 0}\n`);
            if (json.data && json.data.length > 0) {
                json.data.forEach((m, i) => {
                    console.log(`${i + 1}. ${m.is_from_me ? '➡️ SENT' : '⬅️ RECV'} | ${m.body?.substring(0, 30)}`);
                    console.log(`   Time: ${m.timestamp}`);
                    console.log(`   Chat ID: ${m.chat_id}\n`);
                });
            } else {
                console.log('No messages returned!');
            }
        } catch (e) {
            console.log('Parse error:', e.message);
            console.log('Raw response:', data.substring(0, 500));
        }
    });
}).on('error', (err) => {
    console.error('Connection Error:', err.message);
    console.log('\n⚠️ Make sure the server is running on port ' + PORT);
});
