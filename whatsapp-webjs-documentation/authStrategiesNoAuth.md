# whatsapp-web.js 1.34.2 » Source: authStrategies/NoAuth.js

# Source: authStrategies/NoAuth.js

1.  `'use strict';`

3.  `const BaseAuthStrategy = require('./BaseAuthStrategy');`

5.  `/**`
6.   `* No session restoring functionality`
7.   `* Will need to authenticate via QR code every time`
8.  `*/`
9.  `class NoAuth extends BaseAuthStrategy { }`

12.  `module.exports = NoAuth;`