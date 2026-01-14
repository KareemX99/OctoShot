# whatsapp-web.js 1.34.2 » Source: structures/Base.js

# Source: structures/Base.js

1.  `'use strict';`

3.  `/**`
4.   `* Represents a WhatsApp data structure`
5.   `*/`
6.  `class Base {`
7.      `constructor(client) {`
8.          `/**`
9.           `* The client that instantiated this`
10.           `* @readonly`
11.           `*/`
12.          `Object.defineProperty(this, 'client', { value: client });`
13.      `}`

15.      `_clone() {`
16.          `return Object.assign(Object.create(this), this);`
17.      `}`

19.      `_patch(data) { return data; }`
20.  `}`

22.  `module.exports = Base;`