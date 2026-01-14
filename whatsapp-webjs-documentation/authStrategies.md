# whatsapp-web.js 1.34.2 » Source: authStrategies/BaseAuthStrategy.js

# Source: authStrategies/BaseAuthStrategy.js

1.  `'use strict';`

3.  `/**`
4.   `* Base class which all authentication strategies extend`
5.   `*/`
6.  `class BaseAuthStrategy {`
7.      `constructor() {}`
8.      `setup(client) {`
9.          `this.client = client;`
10.      `}`
11.      `async beforeBrowserInitialized() {}`
12.      `async afterBrowserInitialized() {}`
13.      `async onAuthenticationNeeded() {`
14.          `return {`
15.              `failed: false,`
16.              `restart: false,`
17.              `failureEventPayload: undefined`
18.          `};`
19.      `}`
20.      `async getAuthEventPayload() {}`
21.      `async afterAuthReady() {}`
22.      `async disconnect() {}`
23.      `async destroy() {}`
24.      `async logout() {}`
25.  `}`

27.  `module.exports = BaseAuthStrategy;`