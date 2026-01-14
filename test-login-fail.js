const http = require('http');

const data = JSON.stringify({
    email: 'admin@OctoSHOT.com',
    password: 'WRONGPASSWORD'
});

const options = {
    hostname: 'localhost',
    port: 3002,
    path: '/api/admin/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
});

req.write(data);
req.end();
