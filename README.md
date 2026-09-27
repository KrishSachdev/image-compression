# Compress Lab

Compress Lab is a private image toolbox that runs entirely in your browser. It started as an image compressor and now has 18 tools for everyday image jobs. Your images are never uploaded: everything happens on your device, and the app works offline once it has loaded.

Current version: Version 5 (image toolbox)

## Tools

**Shrink & convert**
- Compress & convert: WebP, JPEG, PNG and PNG palette, with a side-by-side compare, target file size and batch mode
- Resize: by width and height, percent, or to fit inside a box
- Convert format: change the file type of one image or many
- PDF to images: turn the pages of a PDF into PNG, JPEG or WebP pictures

**Combine & split**
- Images to PDF: many images into one PDF (A4, Letter or fit-to-image)
- Split image: cut a picture into equal pieces, e.g. 3 across for a carousel
- Stitch images: side by side, stacked or in a grid
- Collage: 2 to 9 photos in a grid or featured layout
- GIF maker: turn several photos into an animated GIF

**Edit**
- Crop: aspect presets for posts, stories and video, plus rotate and flip
- Adjust & filters: brightness, contrast, saturation, warmth; black & white, sepia, invert
- Frame & border: fit a whole photo into a square, 4:5 or story canvas without cropping
- Watermark: text or logo, nine positions or repeated across the picture
- Remove background: make a plain background see-through (colour-based)

**Privacy**
- Hide details: cover faces, names or numbers with a solid box, pixelation or blur
- Remove metadata: see what a photo gives away (location, phone, date) and remove it without re-compressing

**Colour & make**
- Colour picker & palette: pick colours and pull out a picture's main colours
- QR code maker: links, text, Wi-Fi logins or contact cards, as PNG or SVG

## How To Use

1. Open the app. It starts on All tools.
2. Pick a tool from the grid or the tool bar.
3. Drop, paste or choose your image (or PDF for PDF to images).
4. Adjust the settings.
5. Download the result, or send it to Compress to make it smaller.

## Run Locally

Option 1: Open directly

Open `index.html` in a browser. Most features work this way.

Option 2: Local server (needed for installing it as an app and for offline use)

```
python -m http.server 8000
```

Then open http://localhost:8000

## Privacy

All processing happens in your browser. Images and PDFs are never uploaded to a server.

## Credits

PDF to images uses [pdf.js](https://mozilla.github.io/pdf.js/) by Mozilla (Apache License 2.0), included in `js/vendor/pdfjs/` with its licence.
