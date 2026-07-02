# Compress Lab

Compress Lab is a browser-based image compression tool. It lets you upload, paste, preview, compare, and download compressed images using common web formats.

Current version: Version 4

Live Site

GitHub Pages URL:

https://krishsachdev.github.io/image-compression/

Features

- Upload images by selecting, dragging, or pasting
- Compress single images or batches
- Download compressed images individually or as a ZIP
- Compare original vs compressed output
- Preview original, compressed, and split comparison views
- Adjust quality, size, target file size, color count, dithering, and matte color
- Supports saved settings
- Includes zoom and preview controls
- Works fully in the browser
- Installable as a PWA when served from GitHub Pages or a local server

Compression Formats

- WebP: Good default for small files, photos, and transparency
- JPEG: Best compatibility for photos, but does not support transparency
- PNG: Lossless format for screenshots, logos, and sharp graphics
- PNG Palette: Smaller PNG output using fewer colors
- AVIF: Efficient modern format, available only if the browser supports AVIF encoding

How To Use

1. Open the website.
2. Upload, drag, or paste an image.
3. Choose a quick option or select a format manually.
4. Adjust settings if needed.
5. Click Compress image.
6. Download the compressed output.

Run Locally

Option 1: Open Directly

Open this file in a browser:

index.html

Most features work directly this way.

Option 2: Local Server

Use this option to test installable app and offline features.

python -m http.server 8000

Then open:

http://localhost:8000

GitHub Pages Setup

This project is designed to work with GitHub Pages.

Recommended setup:

- Repository: KrishSachdev/image-compression
- Branch: main
- GitHub Pages source: main / root

Published URL:

https://krishsachdev.github.io/image-compression/

Notes

All compression happens locally in the browser. Images are not uploaded to a server.
