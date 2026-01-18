const http = require('http');

const data = JSON.stringify({
    device_name: 'Test Device from Script'
});

const options = {
    hostname: 'localhost',
    port: 3031,
    path: '/api/profiles',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);

    let responseBody = '';
    res.on('data', (chunk) => {
        responseBody += chunk;
    });

    res.on('end', () => {
        console.log('Response Body:', responseBody);
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();
