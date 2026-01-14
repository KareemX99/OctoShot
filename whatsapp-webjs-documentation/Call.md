# whatsapp-web.js 1.34.2 » Class: Call

class

# Call

Source: [structures/Call.js:9](structures_Call.js.html#source-line-9)

Represents a Call on WhatsApp

## Properties

[canHandleLocally](Call.html#canHandleLocally)

[from](Call.html#from)

[fromMe](Call.html#fromMe)

[id](Call.html#id)

[isGroup](Call.html#isGroup)

[isVideo](Call.html#isVideo)

[participants](Call.html#participants)

[timestamp](Call.html#timestamp)

[webClientShouldHandle](Call.html#webClientShouldHandle)

## Method

[reject()](Call.html#reject)

## new Call()

Extends

[Base](Base.html)

## Properties

### canHandleLocally  boolean

Indicates if the call can be handled in waweb

### from  string

From

### fromMe  boolean

Indicates if the call was sent by the current user

### id  string

Call ID

### isGroup  boolean

Is Group

### isVideo  boolean

Is video

### participants  object

Object with participants

### timestamp  number

Unix timestamp for when the call was created

### webClientShouldHandle  boolean

Indicates if the call Should be handled in waweb

## Method

async

### reject()

Reject the call