# whatsapp-web.js 1.34.2 » Class: LocalAuth

class

# LocalAuth

Source: [authStrategies/LocalAuth.js:14](authStrategies_LocalAuth.js.html#source-line-14)

Local directory-based authentication

## new LocalAuth(options)

### Parameters

Name

Type

Optional

Description

options

options

Values in `options` have the following properties:

Name

Type

Optional

Description

clientId

Client id to distinguish instances if you are using multiple, otherwise keep null if you are using only one instance

dataPath

Change the default path for saving session files, default is: "./.wwebjs\_auth/"

rmMaxRetries

Sets the maximum number of retries for removing the session directory