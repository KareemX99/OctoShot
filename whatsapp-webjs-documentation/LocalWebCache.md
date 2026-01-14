# whatsapp-web.js 1.34.2 » Class: LocalWebCache

class

# LocalWebCache

Source: [webCache/LocalWebCache.js:12](webCache_LocalWebCache.js.html#source-line-12)

LocalWebCache - Fetches a WhatsApp Web version from a local file store

## new LocalWebCache(options)

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

path

Path to the directory where cached versions are saved, default is: "./.wwebjs\_cache/"

strict

If true, will throw an error if the requested version can't be fetched. If false, will resolve to the latest version.