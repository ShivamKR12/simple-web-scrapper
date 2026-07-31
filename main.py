import os
import re
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
import requests


def dump_offline_site(url, output_dir="."):
  # 1. Create all asset folders (including fonts for CSS @font-face rules)
  for folder in ["css", "js", "images", "media", "fonts"]:
    os.makedirs(os.path.join(output_dir, folder), exist_ok=True)

  print(f"1. Loading page with Playwright: {url}")
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(url, wait_until="networkidle", timeout=30000)

    # Scroll to bottom to trigger lazy-loaded assets
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(2000)

    html_content = page.content()
    browser.close()

  soup = BeautifulSoup(html_content, "html.parser")

  # 2. Download CSS stylesheets AND inspect them for url(...) assets
  css_links = [
      link
      for link in soup.find_all("link")
      if "stylesheet" in link.get("rel", [])
      or link.get("as") == "style"
      or link.get("href", "").endswith(".css")
  ]
  print(f"\n2. Downloading and inspecting {len(css_links)} CSS file(s)...")
  for idx, link in enumerate(css_links, 1):
    css_url = link.get("href")
    if css_url:
      full_css_url = urljoin(url, css_url)
      local_path = download_and_map(
          url, css_url, output_dir, "css", f"style_{idx}.css"
      )
      if local_path:
        link["href"] = local_path
        # Post-process the saved CSS file to grab background images & fonts
        saved_css_path = os.path.join(output_dir, local_path)
        process_css_urls(saved_css_path, full_css_url, output_dir)

  # 3. Download JS script files
  js_scripts = soup.find_all("script", src=True)
  print(f"\n3. Downloading {len(js_scripts)} JS file(s)...")
  for idx, script in enumerate(js_scripts, 1):
    js_url = script.get("src")
    local_path = download_and_map(
        url, js_url, output_dir, "js", f"script_{idx}.js"
    )
    if local_path:
      script["src"] = local_path

  # 4. Download Images and Icons (<img>, <link rel="icon">, <link rel="apple-touch-icon">)
  images = soup.find_all("img", src=True)
  icons = [
      link
      for link in soup.find_all("link")
      if any(
          rel_type in link.get("rel", [])
          for rel_type in ["icon", "apple-touch-icon", "shortcut icon"]
      )
  ]
  print(
      f"\n4. Downloading {len(images) + len(icons)} HTML image(s) and"
      " icon(s)..."
  )
  for idx, img in enumerate(images, 1):
    img_url = img.get("src")
    local_path = download_and_map(
        url, img_url, output_dir, "images", f"img_{idx}.png"
    )
    if local_path:
      img["src"] = local_path
      if img.get("srcset"):
        del img["srcset"]  # Remove responsive sets so local src is used

  for idx, icon in enumerate(icons, 1):
    icon_url = icon.get("href")
    local_path = download_and_map(
        url, icon_url, output_dir, "images", f"icon_{idx}.ico"
    )
    if local_path:
      icon["href"] = local_path

  # 5. Download Videos (<video src>, <source src>)
  videos = soup.find_all(["video", "source"], src=True)
  print(f"\n5. Downloading {len(videos)} video asset(s)...")
  for idx, vid in enumerate(videos, 1):
    vid_url = vid.get("src")
    local_path = download_and_map(
        url, vid_url, output_dir, "media", f"video_{idx}.mp4"
    )
    if local_path:
      vid["src"] = local_path

  # 6. Save the rewritten HTML
  html_path = os.path.join(output_dir, "index.html")
  with open(html_path, "w", encoding="utf-8") as f:
    f.write(soup.prettify())
  print(f"\n[SUCCESS] -> Rewritten offline HTML saved to '{html_path}'!")


def process_css_urls(css_path, css_full_url, output_dir):
  """Scans a downloaded CSS file for url(...) rules, downloads assets, and rewrites paths."""
  try:
    with open(css_path, "r", encoding="utf-8", errors="ignore") as f:
      content = f.read()

    # Match anything inside url('...'), url("..."), or url(...)
    url_pattern = re.compile(
        r'url\(\s*[\'"]?([^\'"\)]+)[\'"]?\s*\)', re.IGNORECASE
    )
    matches = set(url_pattern.findall(content))

    if matches:
      print(
          f"   [CSS Inspection] Found {len(matches)} url(...) reference(s) in"
          f" {os.path.basename(css_path)}"
      )

    for raw_url in matches:
      # Ignore base64 data URIs, SVG filters (#id), and empty strings
      if (
          not raw_url
          or raw_url.startswith("data:")
          or raw_url.startswith("#")
      ):
        continue

      # Route fonts to /fonts and images to /images
      clean_path = urlparse(raw_url).path.lower()
      if any(
          clean_path.endswith(ext)
          for ext in [".woff", ".woff2", ".ttf", ".eot", ".otf"]
      ):
        folder = "fonts"
      else:
        folder = "images"

      # Download the asset using the CSS file's URL as the base URL
      local_rel_path = download_and_map(
          css_full_url, raw_url, output_dir, folder, "css_asset"
      )

      if local_rel_path:
        # Since CSS files live in /css, relative path to /images or /fonts is ../folder/filename
        rel_from_css = f"../{local_rel_path}"
        content = content.replace(raw_url, rel_from_css)

    with open(css_path, "w", encoding="utf-8") as f:
      f.write(content)
  except Exception as e:
    print(f"   [CSS Parse Error] {css_path}: {e}")


def download_and_map(
    base_url, asset_url, output_dir, folder_name, fallback_name
):
  """Downloads an asset and returns its new local relative path."""
  if not asset_url or asset_url.startswith("data:"):
    return None

  full_url = urljoin(base_url, asset_url)

  parsed_url = urlparse(full_url)
  filename = os.path.basename(parsed_url.path)
  if not filename or len(filename) > 80:
    filename = fallback_name

  # Sanitize invalid filename characters
  filename = re.sub(r'[\\/*?:"<>|]', "_", filename)

  dest_path = os.path.join(output_dir, folder_name, filename)

  # Don't re-download if multiple CSS files reference the same font/image
  if os.path.exists(dest_path):
    return f"{folder_name}/{filename}"

  try:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    resp = requests.get(full_url, headers=headers, timeout=20)
    if resp.status_code == 200:
      with open(dest_path, "wb") as f:
        f.write(resp.content)
      print(f"   [OK] {folder_name}/{filename}")
      return f"{folder_name}/{filename}"
    else:
      print(f"   [FAIL - HTTP {resp.status_code}] {full_url}")
      return None
  except Exception as e:
    print(f"   [ERROR] {full_url}: {e}")
    return None


if __name__ == "__main__":
  target_url = "https://frame-craft-271.preview.static.emergentagent.com/"
  dump_offline_site(target_url)
