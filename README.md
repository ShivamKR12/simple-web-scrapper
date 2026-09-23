# Simple Web Scrapper

<div align="center">

![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)
![Utility](https://img.shields.io/badge/Type-Web%20Scraping%20Utility-FF9800)

</div>

**Simple Web Scrapper** is a powerful yet lightweight Python utility designed to download complete web pages and mirror their structure locally. Rather than just extracting raw text, this tool ensures that CSS stylesheets, JavaScript files, high-resolution images, and fonts are preserved, allowing you to view scraped sites entirely offline as they were meant to be seen.

This is an excellent tool for archiving web designs, studying frontend architectures, or securing offline access to documentation.

## 🌟 Key Features

- **Full Page Archival**: Downloads the HTML document along with all linked assets.
- **Asset Parsing & Structuring**: Automatically categorizes downloaded assets into a clean folder structure (`/css`, `/js`, `/images`, `/fonts`).
- **Dynamic Link Rewriting**: Modifies internal HTML links to point to your new local asset directories, ensuring the offline page renders perfectly.
- **Robust Error Handling**: Skips dead links seamlessly without crashing the scraping process.
- **Debug & Logging**: Captures execution screenshots (`debug.png`) and outputs progress logs to the console.

## 🛠️ Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/simple-web-scrapper.git
   cd simple-web-scrapper
   ```

2. **Create a Virtual Environment** (Optional but recommended)
   ```bash
   python -m venv venv
   ```
   *Windows:* `.\venv\Scripts\activate`
   *macOS/Linux:* `source venv/bin/activate`

3. **Install Required Libraries**
   Depending on the scraper backend (e.g., Requests, BeautifulSoup, Selenium), install the `requirements.txt` (if provided) or install them manually:
   ```bash
   pip install requests beautifulsoup4
   ```

## 🚀 Usage Guide

To initiate the web scraper, simply execute the main python script. 

```bash
python main.py
```

*(Note: Depending on the script's configuration, you may need to pass the target URL as a command-line argument, or edit the `main.py` file directly to set the target URL).*

Once finished, the scraped content will be available in the local directory, with `index.html` acting as the entry point.

## 📁 Directory Architecture

```text
simple-web-scrapper/
├── css/                     # Downloaded stylesheets (e.g., main.css)
├── js/                      # Downloaded JavaScript files
├── images/                  # Extracted images (JPEGs, PNGs)
├── fonts/                   # Web fonts (.woff, .ttf)
├── media/                   # Extracted video/audio files
├── site_dump/               # Raw HTML dumps and metadata
├── debug.png                # Screenshot output for debugging purposes
├── index.html               # The local entry point of the scraped page
└── main.py                  # The core scraping engine script
```

## ⚠️ Disclaimer

This tool is intended for educational purposes and personal archival. Please respect the `robots.txt` files of the websites you are scraping and ensure you comply with their terms of service regarding automated data extraction.

## 📜 License

This project is licensed under the MIT License.
