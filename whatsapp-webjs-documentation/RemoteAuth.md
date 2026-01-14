# whatsapp-web.js 1.34.2 » Class: RemoteAuth

class

# RemoteAuth

Source: [authStrategies/RemoteAuth.js:27](authStrategies_RemoteAuth.js.html#source-line-27)

Remote-based authentication

## new RemoteAuth(options)

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

store

Remote database store instance

clientId

Client id to distinguish instances if you are using multiple, otherwise keep null if you are using only one instance

dataPath

Change the default path for saving session files, default is: "./.wwebjs\_auth/"

backupSyncIntervalMs

Sets the time interval for periodic session backups. Accepts values starting from 60000ms {1 minute}

rmMaxRetries

Sets the maximum number of retries for removing the session directory