const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} when downloading from ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          try {
            fs.chmodSync(dest, 0o755);
          } catch {}
          resolve();
        });
      });
      file.on("error", (err) => {
        fs.unlink(dest, () => reject(err));
      });
    }).on("error", reject);
  });
}

async function main() {
  console.log("[install-ytdlp] Setting up yt-dlp and ffmpeg for cinema video streaming...");

  const binDir = path.join(__dirname, "..", "bin");
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // 1. Try pip3 / pip install for system Python environment
  const pipCommands = [
    "pip3 install --upgrade --break-system-packages yt-dlp",
    "pip install --upgrade --break-system-packages yt-dlp",
    "pip3 install --upgrade yt-dlp",
    "pip install --upgrade yt-dlp",
    "python3 -m pip install --upgrade yt-dlp",
    "python -m pip install --upgrade yt-dlp"
  ];

  for (const cmd of pipCommands) {
    try {
      execSync(cmd, { stdio: "ignore" });
      console.log(`[install-ytdlp] Successfully installed/updated via: ${cmd.split(" ")[0]}`);
      break;
    } catch {}
  }

  // 2. On Linux (Render cloud hosting), download official standalone compiled Linux yt-dlp binary (bundled PyInstaller) as guaranteed fallback
  if (process.platform === "linux") {
    const linuxBin = path.join(binDir, "yt-dlp");
    console.log(`[install-ytdlp] Ensuring standalone Linux binary at ${linuxBin}...`);

    let curlSuccess = false;
    try {
      execSync(`curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "${linuxBin}" && chmod a+rx "${linuxBin}"`, {
        stdio: "inherit"
      });
      curlSuccess = true;
      console.log("[install-ytdlp] Standalone Linux yt-dlp binary downloaded via curl.");
    } catch (e) {
      console.log("[install-ytdlp] curl failed, using Node https fallback...");
    }

    if (!curlSuccess) {
      try {
        await downloadFile("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux", linuxBin);
        console.log("[install-ytdlp] Standalone Linux yt-dlp binary downloaded via Node https.");
      } catch (err) {
        console.warn("[install-ytdlp] Warning: Failed to download Linux binary:", err.message);
      }
    }

    // 3. Ensure static ffmpeg binary is available in bin/ffmpeg for remuxing & EAC3 audio transcoding
    const ffmpegBin = path.join(binDir, "ffmpeg");
    if (!fs.existsSync(ffmpegBin)) {
      console.log(`[install-ytdlp] Downloading static Linux ffmpeg to ${ffmpegBin}...`);
      let ffmpegSuccess = false;
      try {
        execSync(`curl -fsSL https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/linux-x64 -o "${ffmpegBin}" && chmod a+rx "${ffmpegBin}"`, {
          stdio: "inherit"
        });
        ffmpegSuccess = true;
        console.log("[install-ytdlp] Static Linux ffmpeg installed successfully!");
      } catch (err) {
        console.warn("[install-ytdlp] ffmpeg curl download notice:", err.message);
      }

      if (!ffmpegSuccess) {
        try {
          await downloadFile("https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/linux-x64", ffmpegBin);
          console.log("[install-ytdlp] Static Linux ffmpeg downloaded via Node https!");
        } catch (err) {
          console.warn("[install-ytdlp] ffmpeg Node https download error:", err.message);
        }
      }
    }
  }

  console.log("[install-ytdlp] Setup complete.");
}

main().catch((err) => {
  console.warn("[install-ytdlp] Setup notice:", err.message);
  process.exit(0);
});
