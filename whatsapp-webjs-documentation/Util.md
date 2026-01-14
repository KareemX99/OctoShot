# whatsapp-web.js 1.34.2 » Class: Util

class

# Util

Source: [util/Util.js:14](util_Util.js.html#source-line-14)

Utility methods

## Methods

[formatImageToWebpSticker(media)](Util.html#.formatImageToWebpSticker)

[formatToWebpSticker(media, metadata)](Util.html#.formatToWebpSticker)

[formatVideoToWebpSticker(media)](Util.html#.formatVideoToWebpSticker)

[setFfmpegPath(path)](Util.html#.setFfmpegPath)

## new Util()

## Methods

async static

### formatImageToWebpSticker(media) → Promise containing [MessageMedia](MessageMedia.html)

Formats a image to webp

#### Parameter

Name

Type

Optional

Description

media

[MessageMedia](MessageMedia.html)

Returns

`Promise containing [MessageMedia](MessageMedia.html)` 

media in webp format

async static

### formatToWebpSticker(media, metadata) → Promise containing [MessageMedia](MessageMedia.html)

Formats a media to webp

#### Parameters

Name

Type

Optional

Description

media

[MessageMedia](MessageMedia.html)

metadata

[StickerMetadata](global.html#StickerMetadata)

Returns

`Promise containing [MessageMedia](MessageMedia.html)` 

media in webp format

async static

### formatVideoToWebpSticker(media) → Promise containing [MessageMedia](MessageMedia.html)

Formats a video to webp

#### Parameter

Name

Type

Optional

Description

media

[MessageMedia](MessageMedia.html)

Returns

`Promise containing [MessageMedia](MessageMedia.html)` 

media in webp format

static

### setFfmpegPath(path)

Configure ffmpeg path

#### Parameter

Name

Type

Optional

Description

path

string